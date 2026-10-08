// İÇERİK SCRIPT'İ
// Bu dosya doğrudan web sayfası bağlamında çalışır ve tüm okuma/yapay zeka işlemlerinin
// ana durum yönetimini üstlenir. Bu sayede, uzantı paneli (popup) kapatılsa dahi
// sesli okuma arka planda kesintisiz devam eder ve sayfadaki paragraflara
// tıklandığında anında atlama yapılabilir.

// VEKİL SUNUCU (BACKEND) URL'İ
const BACKEND_URL = "https://backend-five-psi-67.vercel.app";
// DOĞRUDAN GEMINI FALLBACK ANAHTARI (Sunucu kapalıysa otomatik devreye girer)
// Guvenlik nedeniyle fallback anahtari bos birakilmistir. Backend vekil sunucusunu kullaniniz veya kendi anahtarinizi ekleyiniz.`nconst GEMINI_FALLBACK_KEY = "";

// ELEVENLABS DEĞİŞKENLERİ VE ANAHTARI
// Guvenlik nedeniyle acik anahtar kaldirilmistir. Kendi anahtarinizi ekleyebilirsiniz.`nconst ELEVENLABS_FALLBACK_KEY = "";
let elevenLabsVoiceId = "0DihkedLJYKoWg7H1u4d";
let elevenAudio = null;
let elevenLabsVoicesList = [];
let preFetchedAudioBlob = null;
let preFetchedIndex = -1;
let currentElevenFetchIndex = -1;

// ─── ANLIK DURUM YÖNETİCİSİ (STATE MACHINE) ──────────────────
let state = {
  isPlaying: false,
  paragraphs: [],
  currentPara: -1,
  readSpeed: 1.0,
  readingModeActive: false,
  fontSize: 22,
  lineHeight: 1.8,
  isLight: false,
  selectedVoice: ""
};

let overlay = null;
let _cachedText = null;
let _cachedUrl  = null;
let _highlightStyle = false;

// Yerel ses motoru (Native Speech) değişkenleri
let nativeUtterance = null;
let speakTimeout = null;

// Yerel depolamadan kullanıcı tercihlerini geri yükle
chrome.storage.local.get(["fontSize", "lineHeight", "isLight", "readSpeed", "selectedVoice"], (data) => {
  if (data.fontSize) state.fontSize = parseInt(data.fontSize);
  if (data.lineHeight) state.lineHeight = parseFloat(data.lineHeight) / 10;
  if (data.readSpeed) state.readSpeed = parseFloat(data.readSpeed) / 10;
  if (data.isLight !== undefined) state.isLight = data.isLight;
  if (data.selectedVoice) state.selectedVoice = data.selectedVoice;
});

// ElevenLabs ses listesini al ve Ergun Kalbak sesini bul
async function findErgunKalbakVoice() {
  const localProxyUrl = `${BACKEND_URL}/api/voices-elevenlabs`;
  console.log("ElevenLabs sesleri alınıyor...", localProxyUrl);
  
  try {
    // 1. Önce proxy sunucuyu dene (CORS engelini aşmak için en güvenli yol)
    const response = await fetch(localProxyUrl);
    if (response.ok) {
      const data = await response.json();
      if (data && data.voices) {
        resolveElevenLabsVoice(data.voices);
        return;
      }
    }
  } catch (err) {
    console.log("ElevenLabs Proxy ses listesi hatası, doğrudan bağlanılıyor...", err);
  }

  // 2. Doğrudan API'yi dene (Fallback - CORS engeline takılabilir)
  try {
    const response = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: {
        "xi-api-key": ELEVENLABS_FALLBACK_KEY
      }
    });
    if (response.ok) {
      const data = await response.json();
      if (data && data.voices) {
        resolveElevenLabsVoice(data.voices);
      }
    } else {
      console.error("ElevenLabs doğrudan ses listesi alınamadı. HTTP Durumu:", response.status);
    }
  } catch (err) {
    console.error("ElevenLabs doğrudan ses listesi alma hatası:", err);
  }
}

function resolveElevenLabsVoice(voices) {
  if (!voices || voices.length === 0) {
    console.warn("ElevenLabs: Hesabınızda hiç ses bulunamadı.");
    return;
  }
  elevenLabsVoicesList = voices; // Tüm ElevenLabs ses listesini kaydet
  
  // Ergun Kalbak veya benzeri bir isim ara, yoksa ilk klonlanmış veya ilk sesi seç
  const ergunVoice = voices.find(v => 
    v.name.toLowerCase().includes("ergun") || 
    v.name.toLowerCase().includes("kalbak")
  ) || voices.find(v => v.category === "cloned") || voices[0];

  if (ergunVoice) {
    elevenLabsVoiceId = ergunVoice.voice_id;
    console.log("ElevenLabs Seçilen Ses Eşleşti:", ergunVoice.name, "(ID:", elevenLabsVoiceId, ")");
  }
}

// Ergun Kalbak sesini yükle
findErgunKalbakVoice();

// ─── UZANTI PANELİ İLE HABERLEŞME ─────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.action) {
    case "getText":
      ensureParagraphs();
      sendResponse({ text: _cachedText });
      break;

    case "getState":
      ensureParagraphs();
      sendResponse({
        state: {
          isPlaying: state.isPlaying,
          currentPara: state.currentPara,
          totalParas: state.paragraphs.length,
          readSpeed: state.readSpeed,
          readingModeActive: state.readingModeActive,
          fontSize: state.fontSize,
          lineHeight: state.lineHeight,
          isLight: state.isLight
        }
      });
      break;

    case "cmdPlay":
      ensureParagraphs();
      if (state.paragraphs.length === 0) {
        sendResponse({ error: "Sayfada okunacak metin bulunamadı" });
        return;
      }
      if (state.currentPara === -1) {
        playParagraph(0);
      } else {
        playParagraph(state.currentPara);
      }
      sendResponse({ success: true });
      break;

    case "cmdPause":
      pausePlayback();
      sendResponse({ success: true });
      break;

    case "cmdPrev":
      ensureParagraphs();
      if (state.currentPara > 0) {
        playParagraph(state.currentPara - 1);
      }
      sendResponse({ success: true });
      break;

    case "cmdNext":
      ensureParagraphs();
      if (state.currentPara < state.paragraphs.length - 1) {
        playParagraph(state.currentPara + 1);
      } else {
        pausePlayback();
      }
      sendResponse({ success: true });
      break;

    case "cmdSetSpeed":
      state.readSpeed = parseFloat(msg.value);
      if (nativeUtterance) {
        nativeUtterance.rate = state.readSpeed;
      }
      notifyPopupState();
      sendResponse({ success: true });
      break;

    case "cmdSetFontSize":
      state.fontSize = parseInt(msg.value);
      applyReaderStyles();
      notifyPopupState();
      sendResponse({ success: true });
      break;

    case "cmdSetLineHeight":
      state.lineHeight = parseFloat(msg.value);
      applyReaderStyles();
      notifyPopupState();
      sendResponse({ success: true });
      break;

    case "cmdToggleTheme":
      state.isLight = msg.isLight;
      applyTheme(state.isLight);
      notifyPopupState();
      sendResponse({ success: true });
      break;

    case "cmdToggleReadMode":
      state.readingModeActive = msg.enabled;
      state.readingModeActive ? enableReadMode() : disableReadMode();
      notifyPopupState();
      sendResponse({ success: true });
      break;

    case "cmdSetVoice":
      state.selectedVoice = msg.value;
      if (state.isPlaying && state.currentPara !== -1) {
        stopParagraphNative();
        stopParagraphElevenLabs();
        playParagraph(state.currentPara);
      } else if (nativeUtterance) {
        const voices = window.speechSynthesis.getVoices();
        const targetVoice = voices.find(v => v.name === state.selectedVoice);
        if (targetVoice) nativeUtterance.voice = targetVoice;
      }
      sendResponse({ success: true });
      break;

    case "getElevenLabsVoices":
      sendResponse({ voices: elevenLabsVoicesList });
      break;

    case "getSelectedText":
      sendResponse({ text: window.getSelection().toString().trim() });
      break;

    case "queryGemini":
      callGeminiAPI(msg.prompt, msg.context)
        .then(answer => sendResponse({ answer }))
        .catch(err => sendResponse({ error: err.message }));
      return true; // Asenkron cevap için kanal açık tutulur
  }
  return true;
});

// ─── PARAGRAFLARI ÇIKARMA VE ÖNBELLEKLEME ──────────────────────
function ensureParagraphs() {
  const url = location.href;
  if (_cachedUrl !== url || state.paragraphs.length === 0) {
    _cachedUrl = url;
    _cachedText = extractText();
    state.currentPara = -1; // Yeni sayfaya geçildiğinde konumu sıfırla
    // Paragraf bağlama olaylarını tetikle
    setTimeout(initNormalModeClickToRead, 500);
  }
}

function extractText() {
  const selectors = [
    "article", "main", "[role='main']",
    ".content", ".post-content", ".entry-content",
    ".article-body", "#content", ".story-body"
  ];
  let container = null;
  for (const sel of selectors) {
    container = document.querySelector(sel);
    if (container) break;
  }
  if (!container) container = document.body;

  // Tüm potansiyel metin bloklarını seç
  const allElements = Array.from(container.querySelectorAll("p,h1,h2,h3,h4,li"));
  
  // Canlı sayfayı bozmadan sadece bellek üzerinde filtreleme yap
  const validElements = allElements.filter(el => {
    if (el.closest("script") || el.closest("style") || el.closest("nav") || 
        el.closest("header") || el.closest("footer") || el.closest("aside") ||
        el.closest(".ad") || el.closest(".advertisement") || 
        el.closest("[class*='cookie']") || el.closest("[class*='popup']") || 
        el.closest("[class*='banner']")) {
      return false;
    }
    
    if (el.textContent.trim().length <= 20) return false;
    
    return true;
  });

  state.paragraphs = [];
  
  // Eşleşen her canlı elemente benzersiz bir indeks tanımla (1-e-1 bağ kur)
  validElements.forEach((el, index) => {
    const text = el.textContent.trim();
    state.paragraphs.push(text);
    el.dataset.erisibilirParaIndex = index.toString();
  });

  return state.paragraphs.join("\n\n");
}

// ─── SES OYNATMA VE DURDURMA YÖNETİMİ ─────────────────────────
function playParagraph(index) {
  ensureParagraphs();
  if (index < 0 || index >= state.paragraphs.length) {
    pausePlayback();
    state.currentPara = -1;
    notifyPopupState();
    return;
  }

  state.currentPara = index;
  state.isPlaying = true;
  notifyPopupState();
  highlightParagraph(index);

  const text = state.paragraphs[index];
  
  if (state.selectedVoice && state.selectedVoice.startsWith("ElevenLabs_")) {
    const selectedVoiceId = state.selectedVoice.split("_")[1];
    let voiceIdToUse = selectedVoiceId;
    if (selectedVoiceId === "ErgunKalbak") {
      voiceIdToUse = "0DihkedLJYKoWg7H1u4d";
    } else if (selectedVoiceId === "IremHanim") {
      voiceIdToUse = "eUUtjbi66JcWz3T4Gvvo";
    }
    speakParagraphElevenLabs(text, index, voiceIdToUse);
  } else {
    speakParagraphNative(text, index, state.readSpeed);
  }
}

function pausePlayback() {
  state.isPlaying = false;
  stopParagraphNative();
  stopParagraphElevenLabs();
  notifyPopupState();
}

// ─── ELEVENLABS AUDIO ENGINE ──────────────────────────────────
function preFetchParagraphElevenLabs(index, voiceIdToUse) {
  if (index < 0 || index >= state.paragraphs.length) return;
  if (preFetchedIndex === index) return; // Zaten önbelleğe alınıyor veya alındı

  const text = state.paragraphs[index];
  const activeVoiceId = voiceIdToUse || elevenLabsVoiceId;
  if (!activeVoiceId) return;

  preFetchedIndex = index;
  preFetchedAudioBlob = null;

  const localProxyUrl = `${BACKEND_URL}/api/tts-elevenlabs`;
  console.log(`[Pre-fetch] Paragraf ${index} arka planda yukleniyor...`);

  fetch(localProxyUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      text: text,
      voice_id: activeVoiceId
    })
  })
  .then(async (response) => {
    if (response.ok) {
      preFetchedAudioBlob = await response.blob();
      console.log(`[Pre-fetch Basarili] Paragraf ${index} onbellege alindi.`);
    } else {
      preFetchDirect(text, index, activeVoiceId);
    }
  })
  .catch(() => {
    preFetchDirect(text, index, activeVoiceId);
  });
}

function preFetchDirect(text, index, activeVoiceId) {
  fetch(`https://api.elevenlabs.io/v1/text-to-speech/${activeVoiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": ELEVENLABS_FALLBACK_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75
      }
    })
  })
  .then(async (response) => {
    if (response.ok) {
      preFetchedAudioBlob = await response.blob();
      console.log(`[Pre-fetch Direct Basarili] Paragraf ${index} onbellege alindi.`);
    }
  })
  .catch(err => {
    console.error("[Pre-fetch Direct Hata]", err);
  });
}

function speakParagraphElevenLabs(text, index, voiceIdToUse) {
  stopParagraphElevenLabs();

  const activeVoiceId = voiceIdToUse || elevenLabsVoiceId;

  if (!activeVoiceId) {
    console.warn("ElevenLabs: Ses kimliği bulunamadı, yerel sese geçiliyor.");
    speakParagraphNative(text, index, state.readSpeed);
    return;
  }

  // Aktif fetch işleminin indeksini güncelle (eski fetch isteklerinin oynatılmasını önler)
  currentElevenFetchIndex = index;

  // 1. EĞER ÖNBELLEKTE VARSA DOĞRUDAN ÇAL! (SIFIR BEKLEME SÜRESİ!)
  if (preFetchedIndex === index && preFetchedAudioBlob) {
    console.log(`[Önbellek HIT] Paragraf ${index} bekletilmeden caliniyor.`);
    const blob = preFetchedAudioBlob;
    // Önceden yüklenmiş veriyi oynat
    playElevenBlob(blob, text, index);
    // Sıradaki paragrafı (index + 1) arka planda indirmeye başla!
    preFetchParagraphElevenLabs(index + 1, activeVoiceId);
    return;
  }

  // 2. Önbellekte yoksa (örneğin kullanıcı elle tıklayıp atladıysa) normal yükle
  const localProxyUrl = `${BACKEND_URL}/api/tts-elevenlabs`;
  console.log("ElevenLabs Oynatılıyor. Proxy URL:", localProxyUrl, "Voice ID:", activeVoiceId);

  fetch(localProxyUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      text: text,
      voice_id: activeVoiceId
    })
  })
  .then(async (response) => {
    // Yarış durumunu (race condition) kontrol et: kullanıcı durdurduysa veya atladıysa iptal et
    if (currentElevenFetchIndex !== index || !state.isPlaying) {
      console.log(`[ElevenLabs Engelleyici] Paragraf ${index} isteği yarış durumu nedeniyle iptal edildi.`);
      return;
    }

    if (response.ok) {
      const blob = await response.blob();
      playElevenBlob(blob, text, index);
      // Oynatma başlar başlamaz sıradaki paragrafı önceden yükle!
      preFetchParagraphElevenLabs(index + 1, activeVoiceId);
    } else {
      console.warn("Proxy sunucusu ElevenLabs hatası döndü, doğrudan API'ye bağlanılıyor...");
      speakElevenLabsDirect(text, index, activeVoiceId);
    }
  })
  .catch((err) => {
    // Yarış durumunu (race condition) kontrol et
    if (currentElevenFetchIndex !== index || !state.isPlaying) return;
    console.log("Proxy sunucusu aktif değil, doğrudan ElevenLabs API'sine bağlanılıyor...");
    speakElevenLabsDirect(text, index, activeVoiceId);
  });
}

function speakElevenLabsDirect(text, index, activeVoiceId) {
  const voiceId = activeVoiceId || elevenLabsVoiceId;

  // Yarış durumunu korumak için indeksi tekrar doğrula
  if (currentElevenFetchIndex !== index || !state.isPlaying) return;

  fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": ELEVENLABS_FALLBACK_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      text: text,
      model_id: "eleven_multilingual_v2",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75
      }
    })
  })
  .then(async (response) => {
    // Yarış durumunu (race condition) kontrol et
    if (currentElevenFetchIndex !== index || !state.isPlaying) {
      console.log(`[ElevenLabs Doğrudan Engelleyici] Paragraf ${index} iptal edildi.`);
      return;
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const blob = await response.blob();
    playElevenBlob(blob, text, index);
    // Sıradaki paragrafı önceden yükle
    preFetchParagraphElevenLabs(index + 1, voiceId);
  })
  .catch((err) => {
    // Yarış durumunu (race condition) kontrol et
    if (currentElevenFetchIndex !== index || !state.isPlaying) return;
    console.error("ElevenLabs doğrudan bağlantı hatası, yerel sese dönülüyor:", err);
    speakParagraphNative(text, index, state.readSpeed);
  });
}

function playElevenBlob(blob, text, index) {
  const url = URL.createObjectURL(blob);
  elevenAudio = new Audio(url);
  elevenAudio.playbackRate = state.readSpeed;
  
  elevenAudio.onended = () => {
    if (state.isPlaying && state.currentPara === index) {
      playParagraph(index + 1);
    }
  };

  elevenAudio.onerror = (e) => {
    console.error("Ses çalma hatası:", e);
    if (state.isPlaying && state.currentPara === index) {
      playParagraph(index + 1);
    }
  };

  elevenAudio.play().catch(err => {
    console.error("Oynatma başlatılamadı:", err);
    speakParagraphNative(text, index, state.readSpeed);
  });
}

function stopParagraphElevenLabs() {
  if (elevenAudio) {
    elevenAudio.pause();
    elevenAudio.currentTime = 0;
    elevenAudio = null;
  }
}

function notifyPopupState() {
  chrome.runtime.sendMessage({
    action: "stateUpdated",
    state: {
      isPlaying: state.isPlaying,
      currentPara: state.currentPara,
      totalParas: state.paragraphs.length,
      readSpeed: state.readSpeed,
      readingModeActive: state.readingModeActive,
      fontSize: state.fontSize,
      lineHeight: state.lineHeight,
      isLight: state.isLight
    }
  }, () => {
    // Uzantı paneli kapalıysa oluşabilecek hatayı sessizce yok sayarız
    if (chrome.runtime.lastError) {}
  });
}

// ─── NATIVE SPEECH SYNTHESIS ENGINE (WEB SPEECH API) ──────────
function speakParagraphNative(text, index, speed) {
  stopParagraphNative();

  nativeUtterance = new SpeechSynthesisUtterance(text);
  nativeUtterance.rate = speed;
  nativeUtterance.lang = "tr-TR";

  const voices = window.speechSynthesis.getVoices();
  
  let targetVoice = null;
  
  // 1. Kullanıcının seçmiş olduğu ses varsa onu kullan
  if (state.selectedVoice) {
    targetVoice = voices.find(v => v.name === state.selectedVoice);
  }
  
  // 2. Seçili ses bulunamadıysa (veya ilk okumaysa) akıllı önceliklendirme yap
  if (!targetVoice) {
    // A. Microsoft Edge Natural sesleri (Ahmet / Emel)
    targetVoice = voices.find(v => v.lang.startsWith("tr") && v.name.includes("Natural"));
    
    // B. Google Türkçe online sesi (Chrome için son derece doğal!)
    if (!targetVoice) {
      targetVoice = voices.find(v => v.lang.startsWith("tr") && (v.name.includes("Google") || v.localService === false));
    }
    
    // C. İsmi "Emel" veya "Ahmet" içeren yerel sesler
    if (!targetVoice) {
      targetVoice = voices.find(v => v.lang.startsWith("tr") && (v.name.includes("Emel") || v.name.includes("Ahmet")));
    }
    
    // D. Herhangi bir Türkçe ses (Tolga vb.)
    if (!targetVoice) {
      targetVoice = voices.find(v => v.lang.startsWith("tr"));
    }
  }

  if (targetVoice) {
    nativeUtterance.voice = targetVoice;
    console.log("Seçilen Ses:", targetVoice.name);
  } else {
    console.warn("Yerel Türkçe ses motoru bulunamadı, varsayılan tarayıcı sesi kullanılacak.");
  }

  nativeUtterance.onend = () => {
    if (state.isPlaying && state.currentPara === index) {
      // Bir sonraki paragrafa otomatik geçiş
      playParagraph(index + 1);
    }
  };

  nativeUtterance.onerror = (e) => {
    console.error("Yerel ses oynatma hatası:", e);
    // Kesinti değilse sonraki paragrafa atla
    if (e.error !== 'interrupted') {
      if (state.isPlaying && state.currentPara === index) {
        playParagraph(index + 1);
      }
    }
  };

  // Chrome/Edge cancel-speak zamanlama gecikmesi sorununu çözmek için 100ms gecikmeli tetikleme
  speakTimeout = setTimeout(() => {
    if (state.isPlaying) {
      window.speechSynthesis.speak(nativeUtterance);
    }
  }, 100);
}

function stopParagraphNative() {
  if (speakTimeout) {
    clearTimeout(speakTimeout);
    speakTimeout = null;
  }
  window.speechSynthesis.cancel();
  if (window.speechSynthesis.paused) {
    window.speechSynthesis.resume();
  }
  nativeUtterance = null;
}

if (typeof window !== "undefined" && window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => {
    console.log("Yerel tarayıcı sesleri güncellendi. Mevcut ses sayısı:", window.speechSynthesis.getVoices().length);
  };
}

// ─── SAYFADAKİ PARAGRAFLARA TIKLAYARAK OKUMA (NORMAL MOD) ──────
function initNormalModeClickToRead() {
  if (!state.readingModeActive) return;
  const containerSelectors = [
    "article", "main", "[role='main']",
    ".content", ".post-content", ".entry-content",
    ".article-body", "#content", ".story-body"
  ];
  let container = null;
  for (const sel of containerSelectors) {
    container = document.querySelector(sel);
    if (container) break;
  }
  if (!container) container = document.body;

  // Sadece erisibilirParaIndex tanımlanmış geçerli metin bloklarını seç
  const paras = Array.from(container.querySelectorAll("[data-erisibilir-para-index]"));

  paras.forEach((p) => {
    if (p.dataset.erisibilirBound) return;
    p.dataset.erisibilirBound = "true";

    p.style.cursor = "pointer";
    p.title = "Buradan itibaren okumak için tıklayın";
    
    // Premium hover mikro-etkileşimi
    p.addEventListener("mouseenter", () => {
      p.style.backgroundColor = "rgba(79, 110, 247, 0.04)";
      p.style.borderRadius = "6px";
      p.style.transition = "background-color 0.2s, padding 0.2s";
    });
    p.addEventListener("mouseleave", () => {
      p.style.backgroundColor = "";
    });

    p.addEventListener("click", (e) => {
      // Bağlantı, buton veya yapay zeka paneline tıklanmışsa okuma tetiklenmesin
      if (e.target.tagName === "A" || e.target.closest("a") || e.target.closest("button")) return;
      if (window.getSelection().toString().trim().length > 5) return;
      if (e.target.closest("#erisibilir-ai-panel") || e.target.closest("#erisibilir-ai-btn")) return;
      if (state.readingModeActive) return; // Okuma modu açıksa oradaki özel dinleyici çalışacak
      
      const index = parseInt(p.dataset.erisibilirParaIndex);
      console.log("Normal modda paragrafa tıklandı. İndeks:", index);
      playParagraph(index);
    });
  });
}

// Sayfa yüklendiğinde ve dinamik içerik değişebileceği için periyodik kontrol
setTimeout(initNormalModeClickToRead, 1000);

// ─── OKUMA MODU (GELİŞMİŞ READER VIEW) ─────────────────────────
function enableReadMode() {
  if (state.readingModeActive && overlay) return;
  state.readingModeActive = true;

  // Arka plandaki seçimleri ve AI butonunu temizle
  window.getSelection()?.removeAllRanges();
  hideAiFloatingButton();
  if (aiButton) {
    aiButton.remove();
    aiButton = null;
  }

  ensureParagraphs();
  const paraList = state.paragraphs;

  const frag = document.createDocumentFragment();
  const parasDiv = document.createElement("div");
  parasDiv.id = "erisibilir-body";

  paraList.forEach((p, i) => {
    const el = document.createElement("p");
    el.className    = "reader-para";
    el.dataset.index = i;
    el.textContent  = p;
    
    el.style.cursor = "pointer";
    el.title = "Buradan itibaren okumak için tıklayın";
    el.addEventListener("click", (e) => {
      if (window.getSelection().toString().trim().length > 5) return;
      console.log("Okuma modunda paragrafa tıklandı. İndeks:", i);
      playParagraph(i);
    });

    parasDiv.appendChild(el);
  });
  frag.appendChild(parasDiv);

  overlay = document.createElement("div");
  overlay.id = "erisibilir-overlay";

  const reader = document.createElement("div");
  reader.id = "erisibilir-reader";

  const toolbar = document.createElement("div");
  toolbar.id = "reader-toolbar";
  toolbar.innerHTML = `
    <span id="reader-title">📖 Okuma Modu</span>
    <div id="reader-toolbar-right">
      <button id="erisibilir-close">✕ Kapat</button>
    </div>
  `;

  reader.appendChild(toolbar);
  reader.appendChild(frag);
  overlay.appendChild(reader);

  injectReaderStyle();
  document.body.appendChild(overlay);
  applyReaderStyles();
  applyTheme(state.isLight);

  document.getElementById("erisibilir-close").addEventListener("click", () => {
    state.readingModeActive = false;
    disableReadMode();
    pausePlayback(); // Sesi durdur
    notifyPopupState();
  });
  document.addEventListener("keydown", handleEsc);

  // Eğer zaten bir şey okunuyorsa anında vurgula
  if (state.currentPara !== -1) {
    highlightParagraph(state.currentPara);
  }
}

function handleEsc(e) {
  if (e.key === "Escape") {
    // Eğer AI paneli açıksa ESC tuşu önce onu kapatsın, Okuma Modunu kapatmasın!
    if (document.getElementById("erisibilir-ai-panel")) {
      return;
    }
    state.readingModeActive = false;
    disableReadMode();
    pausePlayback(); // Sesi durdur
    notifyPopupState();
  }
}

function disableReadMode() {
  state.readingModeActive = false;
  
  // Seçimleri ve AI bileşenlerini temizle
  window.getSelection()?.removeAllRanges();
  hideAiFloatingButton();
  if (aiButton) {
    aiButton.remove();
    aiButton = null;
  }
  closeAiPanel();

  overlay?.remove();
  overlay = null;
  document.getElementById("erisibilir-reader-css")?.remove();
  document.removeEventListener("keydown", handleEsc);
}

function injectReaderStyle() {
  if (document.getElementById("erisibilir-reader-css")) return;
  const style = document.createElement("style");
  style.id = "erisibilir-reader-css";
  style.textContent = `
    #erisibilir-overlay {
      position: fixed !important;
      inset: 0 !important;
      z-index: 2147483646 !important;
      background: #0d0f1a !important;
      overflow-y: auto !important;
      display: flex !important;
      justify-content: center !important;
    }
    #erisibilir-reader {
      width: 100% !important;
      max-width: 780px !important;
      min-height: 100vh !important;
      background: #0d0f1a !important;
      color: #dde1f9 !important;
      padding: 0 0 80px !important;
    }
    #reader-toolbar {
      position: sticky !important;
      top: 0 !important;
      background: #13162a !important;
      border-bottom: 1px solid #2e3354 !important;
      padding: 14px 32px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      z-index: 10 !important;
      gap: 12px !important;
    }
    #reader-title {
      font-family: sans-serif !important;
      font-size: 14px !important;
      font-weight: 700 !important;
      color: #8b90b8 !important;
      white-space: nowrap !important;
    }
    #reader-toolbar-right {
      display: flex !important;
      align-items: center !important;
      gap: 16px !important;
    }
    #erisibilir-close {
      background: #1e2238 !important;
      color: #8b90b8 !important;
      border: 1px solid #2e3354 !important;
      border-radius: 8px !important;
      padding: 6px 16px !important;
      font-size: 12px !important;
      font-family: sans-serif !important;
      cursor: pointer !important;
      transition: background 0.2s, color 0.2s, border-color 0.2s !important;
    }
    #erisibilir-close:hover { background: #4f6ef7 !important; color: white !important; border-color: #4f6ef7 !important; }
    #erisibilir-body {
      padding: 48px 48px 0 !important;
      font-family: Georgia, 'Times New Roman', serif !important;
    }
    .reader-para {
      display: block !important;
      margin-bottom: 1.4em !important;
      color: #dde1f9 !important;
      font-family: Georgia, 'Times New Roman', serif !important;
      border-radius: 6px !important;
      padding: 6px 10px !important;
      outline: none !important;
      transition: background 0.15s, border-left 0.15s !important;
      cursor: pointer !important;
    }
    .reader-para:hover  { background: rgba(79,110,247,0.06) !important; }
    .erisibilir-highlight {
      background: rgba(79,110,247,0.2) !important;
      border-left: 4px solid #4f6ef7 !important;
      padding-left: 12px !important;
    }
    @media (max-width: 600px) {
      #erisibilir-body { padding: 24px 20px 0 !important; }
      #reader-toolbar  { padding: 12px 16px !important; }
    }
  `;
  document.head.appendChild(style);
}

function applyReaderStyles() {
  if (!overlay) return;
  const body = document.getElementById("erisibilir-body");
  if (!body) return;
  const fs = state.fontSize + "px";
  const lh = state.lineHeight;
  body.style.fontSize   = fs;
  body.style.lineHeight = lh;
  body.querySelectorAll(".reader-para").forEach(p => {
    p.style.fontSize   = fs;
    p.style.lineHeight = lh;
  });
}

// ─── METİN VURGULAMA (HIGHLIGHT) ──────────────────────────────
function highlightParagraph(index) {
  if (state.readingModeActive && overlay) {
    const body = document.getElementById("erisibilir-body");
    if (!body) return;
    body.querySelectorAll(".erisibilir-highlight").forEach(el => el.classList.remove("erisibilir-highlight"));
    const target = body.querySelector(`.reader-para[data-index="${index}"]`);
    if (target) {
      target.classList.add("erisibilir-highlight");
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    return;
  }

  // Normal sayfa üzerinde okunan paragrafın vurgulanması
  if (!_highlightStyle) {
    const style = document.createElement("style");
    style.id = "erisibilir-highlight-css";
    style.textContent = `
      .erisibilir-highlight {
        background: rgba(79, 110, 247, 0.18) !important;
        border-left: 4px solid #4f6ef7 !important;
        padding-left: 12px !important;
        border-radius: 4px !important;
        transition: background 0.3s, border-left 0.3s !important;
      }
    `;
    document.head.appendChild(style);
    _highlightStyle = true;
  }

  document.querySelectorAll(".erisibilir-highlight").forEach(el => el.classList.remove("erisibilir-highlight"));
  const target = document.querySelector(`[data-erisibilir-para-index="${index}"]`);
  if (target) {
    target.classList.add("erisibilir-highlight");
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

// ─── TEMA UYGULAMA (KOLAY OKUMA İÇİN FİLTRE) ───────────────────
function applyTheme(isLight) {
  document.body.style.filter = isLight ? "invert(1) hue-rotate(180deg)" : "";
  // Görsellerin renklerinin bozulmaması için geri invert uyguluyoruz
  const mediaElements = document.querySelectorAll("img, video, iframe, picture");
  mediaElements.forEach(el => {
    el.style.filter = isLight ? "invert(1) hue-rotate(180deg)" : "";
  });
}

// ─── DİNAMİK YAPAY ZEKA ASİSTANI (METİN SEÇİMİ VE PANEL) ───────
let selectedText = "";
let aiButton = null;
let aiPanel = null;

// mousedown'da tıklanan hedefi kaydet — handleTextSelection buna göre karar verir
let _mousedownTarget = null;

document.addEventListener("mousedown", (e) => {
  _mousedownTarget = e.target;
});

document.addEventListener("mouseup", handleTextSelection);

// Klavye ile seçim sıfırlanınca (Escape, Delete vb.) butonu gizle
document.addEventListener("selectionchange", () => {
  const sel = window.getSelection();
  if (!sel || sel.toString().trim().length === 0) {
    hideAiFloatingButton();
  }
});

function handleTextSelection(e) {
  if (!state.readingModeActive) return;
  // AI butonu veya paneline tıklandıysa hiçbir şey yapma
  if (e.target.closest("#erisibilir-ai-panel") || e.target.closest("#erisibilir-ai-btn")) return;

  setTimeout(() => {
    const selection = window.getSelection();
    selectedText = selection ? selection.toString().trim() : "";

    if (selectedText.length > 5 && selection && !selection.isCollapsed) {
      // Yeni bir seçim yapıldıysa butonu göster
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      showAiFloatingButton(rect);
    } else {
      // Seçim yoksa veya çok kısaysa:
      // 1. Metin seçimini tamamen temizle
      window.getSelection()?.removeAllRanges();
      // 2. AI butonunu gizle
      hideAiFloatingButton();
      // 3. Açık olan prompt / AI panelini kapat ve temizle
      const clickedBtn   = _mousedownTarget && _mousedownTarget.closest("#erisibilir-ai-btn");
      const clickedPanel = _mousedownTarget && _mousedownTarget.closest("#erisibilir-ai-panel");
      if (!clickedBtn && !clickedPanel) {
        closeAiPanel();
      }
    }
  }, 100);
}

function showAiFloatingButton(rect) {
  const container = document.getElementById("erisibilir-overlay") || document.body;

  if (!aiButton) {
    aiButton = document.createElement("button");
    aiButton.id = "erisibilir-ai-btn";
    aiButton.innerHTML = `🪄 AI'a Sor`;
    
    const style = document.createElement("style");
    style.id = "erisibilir-ai-btn-css";
    style.textContent = `
      #erisibilir-ai-btn {
        position: absolute !important;
        z-index: 2147483647 !important;
        background: linear-gradient(135deg, #4f6ef7, #a855f7) !important;
        color: white !important;
        border: none !important;
        border-radius: 20px !important;
        padding: 8px 16px !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
        font-size: 12px !important;
        font-weight: 700 !important;
        cursor: pointer !important;
        box-shadow: 0 6px 20px rgba(168, 85, 247, 0.4) !important;
        display: flex;
        align-items: center !important;
        gap: 6px !important;
        transition: transform 0.2s, box-shadow 0.2s !important;
      }
      #erisibilir-ai-btn:hover {
        transform: translateY(-2px) scale(1.05) !important;
        box-shadow: 0 8px 25px rgba(168, 85, 247, 0.6) !important;
      }
      #erisibilir-ai-btn:active {
        transform: scale(0.98) !important;
      }
    `;
    document.head.appendChild(style);
    aiButton.addEventListener("click", openAiPanel);
  }

  // Doğru konteynere taşı
  if (aiButton.parentElement !== container) {
    container.appendChild(aiButton);
  }

  // Koordinatları konteynere göre hesapla
  if (container.id === "erisibilir-overlay") {
    aiButton.style.left = `${rect.left + container.scrollLeft}px`;
    aiButton.style.top = `${rect.bottom + container.scrollTop + 5}px`;
  } else {
    aiButton.style.left = `${rect.left + window.scrollX}px`;
    aiButton.style.top = `${rect.bottom + window.scrollY + 5}px`;
  }

  aiButton.style.display = "flex";
}

function hideAiFloatingButton() {
  if (aiButton) {
    aiButton.style.display = "none";
  }
}

function closeAiPanel() {
  const panel = document.getElementById("erisibilir-ai-panel");
  if (panel) {
    panel.style.animation = "erisibilir-drawer-out 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards";
    setTimeout(() => {
      const panelToRemove = document.getElementById("erisibilir-ai-panel");
      if (panelToRemove) {
        panelToRemove.remove();
        aiPanel = null;
      }
    }, 350);
  }
}

// AI Panelinin dışına tıklandığında paneli otomatik kapatma
document.addEventListener("mousedown", (e) => {
  if (aiPanel && !aiPanel.contains(e.target) && !e.target.closest("#erisibilir-ai-btn")) {
    closeAiPanel();
  }
});

// Escape tuşuna basıldığında paneli otomatik kapatma
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && aiPanel) {
    closeAiPanel();
  }
});

function openAiPanel() {
  hideAiFloatingButton();

  if (!aiPanel) {
    aiPanel = document.createElement("div");
    aiPanel.id = "erisibilir-ai-panel";
    
    const style = document.createElement("style");
    style.id = "erisibilir-ai-panel-css";
    style.textContent = `
      #erisibilir-ai-panel {
        position: fixed !important;
        top: 0 !important;
        right: 0 !important;
        width: 420px !important;
        height: 100vh !important;
        z-index: 2147483647 !important;
        background: rgba(13, 15, 30, 0.96) !important;
        backdrop-filter: blur(30px) !important;
        border-left: 1px solid rgba(255, 255, 255, 0.08) !important;
        box-shadow: -15px 0 45px rgba(0, 0, 0, 0.7) !important;
        color: #dde1f9 !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
        display: flex !important;
        flex-direction: column !important;
        overflow: hidden !important;
        animation: erisibilir-drawer-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) !important;
      }
      
      #erisibilir-ai-panel ::selection {
        background: rgba(79, 110, 247, 0.3) !important;
        color: inherit !important;
      }
      
      @keyframes erisibilir-drawer-in {
        from { transform: translateX(420px); }
        to { transform: translateX(0); }
      }

      @keyframes erisibilir-drawer-out {
        from { transform: translateX(0); }
        to { transform: translateX(420px); }
      }
      
      #erisibilir-ai-panel *::-webkit-scrollbar {
        width: 6px !important;
        height: 6px !important;
      }
      #erisibilir-ai-panel *::-webkit-scrollbar-track {
        background: transparent !important;
      }
      #erisibilir-ai-panel *::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.15) !important;
        border-radius: 4px !important;
      }
      #erisibilir-ai-panel *::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.3) !important;
      }
      
      .e-ai-header {
        padding: 22px 24px !important;
        background: rgba(20, 24, 45, 0.5) !important;
        border-bottom: 1px solid rgba(255, 255, 255, 0.07) !important;
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
      }
      .e-ai-title {
        font-size: 16px !important;
        font-weight: 800 !important;
        color: #fff !important;
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
        letter-spacing: 0.5px !important;
      }
      .e-ai-close {
        background: rgba(255, 255, 255, 0.05) !important;
        border: none !important;
        border-radius: 50% !important;
        color: #8b90b8 !important;
        width: 32px !important;
        height: 32px !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        font-size: 14px !important;
        cursor: pointer !important;
        transition: background 0.2s, color 0.2s, transform 0.2s !important;
      }
      .e-ai-close:hover {
        background: rgba(255, 255, 255, 0.1) !important;
        color: #fff !important;
        transform: rotate(90deg) !important;
      }
      
      .e-ai-content {
        padding: 24px !important;
        overflow-y: auto !important;
        flex: 1 !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 20px !important;
      }
      
      .e-ai-quote {
        background: rgba(79, 110, 247, 0.08) !important;
        border-left: 4px solid #4f6ef7 !important;
        border-radius: 8px !important;
        padding: 14px 18px !important;
        font-size: 13px !important;
        line-height: 1.6 !important;
        color: #b9bdda !important;
        max-height: 120px !important;
        overflow-y: auto !important;
        font-style: italic !important;
        box-shadow: inset 0 2px 4px rgba(0,0,0,0.1) !important;
        user-select: text !important;
        -webkit-user-select: text !important;
      }
      
      .e-ai-input-group {
        display: flex !important;
        flex-direction: column !important;
        gap: 12px !important;
      }
      .e-ai-input {
        background: rgba(30, 34, 56, 0.4) !important;
        border: 1px solid rgba(255, 255, 255, 0.08) !important;
        border-radius: 10px !important;
        padding: 12px 14px !important;
        color: #fff !important;
        font-size: 13.5px !important;
        outline: none !important;
        resize: none !important;
        height: 60px !important;
        font-family: inherit !important;
        transition: border-color 0.2s, box-shadow 0.2s !important;
      }
      .e-ai-input:focus {
        border-color: #4f6ef7 !important;
        box-shadow: 0 0 0 3px rgba(79, 110, 247, 0.2) !important;
      }
      .e-ai-input::placeholder {
        color: rgba(255, 255, 255, 0.5) !important;
      }
      
      .e-ai-submit {
        background: linear-gradient(135deg, #4f6ef7, #a855f7) !important;
        color: white !important;
        border: none !important;
        border-radius: 10px !important;
        padding: 12px !important;
        font-size: 13.5px !important;
        font-weight: 700 !important;
        cursor: pointer !important;
        box-shadow: 0 4px 15px rgba(168, 85, 247, 0.2) !important;
        transition: transform 0.1s, box-shadow 0.2s, filter 0.2s !important;
      }
      .e-ai-submit:hover {
        box-shadow: 0 6px 20px rgba(168, 85, 247, 0.3) !important;
        filter: brightness(1.1) !important;
      }
      .e-ai-submit:active { transform: scale(0.98); }

      .e-ai-close-bottom {
        background: rgba(255, 255, 255, 0.05) !important;
        border: 1px solid rgba(255, 255, 255, 0.12) !important;
        color: #8b90b8 !important;
        border-radius: 10px !important;
        padding: 12px !important;
        font-size: 13.5px !important;
        font-weight: 700 !important;
        cursor: pointer !important;
        transition: background 0.2s, color 0.2s, border-color 0.2s, transform 0.1s !important;
        font-family: inherit !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
      }
      .e-ai-close-bottom:hover {
        background: rgba(255, 255, 255, 0.12) !important;
        color: #fff !important;
        border-color: rgba(255, 255, 255, 0.2) !important;
      }
      .e-ai-close-bottom:active {
        transform: scale(0.98) !important;
      }
      
      .e-ai-result-title {
        font-size: 13px !important;
        font-weight: 800 !important;
        color: #8b90b8 !important;
        text-transform: uppercase !important;
        letter-spacing: 1px !important;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
        padding-bottom: 8px !important;
        margin-top: 10px !important;
      }
      
      .e-ai-result {
        background: rgba(30, 34, 56, 0.2) !important;
        border: 1px solid rgba(255, 255, 255, 0.04) !important;
        border-radius: 12px !important;
        padding: 18px !important;
        font-size: 13.5px !important;
        line-height: 1.7 !important;
        color: #dde1f9 !important;
        flex: 1 !important;
        min-height: 180px !important;
        overflow-y: auto !important;
        white-space: pre-wrap !important;
        user-select: text !important;
        -webkit-user-select: text !important;
      }
      
      .e-ai-loading {
        display: none !important;
        align-self: center !important;
        margin: 20px 0 !important;
      }
      .e-ai-spinner {
        width: 32px !important;
        height: 32px !important;
        border: 3px solid rgba(168, 85, 247, 0.1) !important;
        border-top-color: #a855f7 !important;
        border-radius: 50% !important;
        animation: e-spin 0.8s linear infinite !important;
      }
      @keyframes e-spin { to { transform: rotate(360deg); } }
    `;
    
    document.head.appendChild(style);
    document.body.appendChild(aiPanel);
  }

  aiPanel.innerHTML = `
    <div class="e-ai-header">
      <div class="e-ai-title">🪄 Erişilebilir Yapay Zeka</div>
      <button class="e-ai-close" id="e-ai-close-btn" title="Kapat">✕</button>
    </div>
    <div class="e-ai-content">
      <div style="display: flex !important; justify-content: space-between !important; align-items: center !important; width: 100% !important;">
        <span style="font-size: 11px !important; font-weight: bold !important; color: #8b90b8 !important; text-transform: uppercase !important; letter-spacing: 0.5px !important;">Seçili Metin</span>
        <button id="e-copy-selected-btn" style="background: transparent !important; border: none !important; color: #4f6ef7 !important; font-size: 11px !important; cursor: pointer !important; font-weight: bold !important; font-family: inherit !important; display: flex !important; align-items: center !important; gap: 4px !important; padding: 2px 6px !important; border-radius: 4px !important; transition: background 0.2s !important;">📋 Kopyala</button>
      </div>
      <div class="e-ai-quote">"${selectedText}"</div>
      
      <div class="e-ai-input-group">
        <textarea class="e-ai-input" id="e-ai-prompt" rows="2" placeholder="Seçilen metinle ilgili başka bir şey sorun..."></textarea>
        <div style="display: flex !important; gap: 8px !important; width: 100% !important;">
          <button class="e-ai-submit" id="e-ai-send" style="flex: 2 !important; margin: 0 !important;">Soru Sor</button>
          <button class="e-ai-close-bottom" id="e-ai-close-bottom-btn" style="flex: 1 !important; margin: 0 !important;">Kapat</button>
        </div>
      </div>
      
      <div class="e-ai-loading" id="e-ai-loading-anim">
        <div class="e-ai-spinner"></div>
      </div>
      
      <div style="display: flex !important; justify-content: space-between !important; align-items: center !important; width: 100% !important; border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important; padding-bottom: 8px !important; margin-top: 10px !important;">
        <span style="font-size: 13px !important; font-weight: 800 !important; color: #8b90b8 !important; text-transform: uppercase !important; letter-spacing: 1px !important;">✨ Yapay Zeka Yanıtı</span>
        <button id="e-copy-response-btn" style="background: transparent !important; border: none !important; color: #4f6ef7 !important; font-size: 11px !important; cursor: pointer !important; font-weight: bold !important; font-family: inherit !important; display: flex !important; align-items: center !important; gap: 4px !important; padding: 2px 6px !important; border-radius: 4px !important; transition: background 0.2s !important;">📋 Kopyala</button>
      </div>
      <div class="e-ai-result" id="e-ai-response">Yapay zeka analizi başlatılıyor...</div>
    </div>
  `;

  document.getElementById("e-ai-close-btn").addEventListener("click", closeAiPanel);
  document.getElementById("e-ai-close-bottom-btn").addEventListener("click", closeAiPanel);

  document.getElementById("e-copy-selected-btn").addEventListener("click", () => {
    copyTextToClipboard(selectedText, document.getElementById("e-copy-selected-btn"));
  });

  document.getElementById("e-copy-response-btn").addEventListener("click", () => {
    const respBox = document.getElementById("e-ai-response");
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = respBox.innerHTML;
    const textToCopy = tempDiv.innerText || tempDiv.textContent;
    copyTextToClipboard(textToCopy.trim(), document.getElementById("e-copy-response-btn"));
  });

  const promptInput = document.getElementById("e-ai-prompt");
  const btnSend = document.getElementById("e-ai-send");
  const responseBox = document.getElementById("e-ai-response");
  const loadingAnim = document.getElementById("e-ai-loading-anim");

  async function executeAiQuery(userPrompt) {
    loadingAnim.style.display = "block";
    btnSend.disabled = true;

    try {
      const responseText = await callGeminiAPI(userPrompt, selectedText);
      responseBox.innerHTML = formatMarkdown(responseText); // Markdown biçimlendiriciyi kullan
    } catch (err) {
      responseBox.innerHTML = `<span style='color: #f87171;'>Hata Oluştu: ${err.message}</span>`;
    } finally {
      loadingAnim.style.display = "none";
      btnSend.disabled = false;
    }
  }

  // AÇILDIĞI AN OTOMATİK OLARAK ANALİZİ BAŞLAT (Tek tıkla sihir!)
  const defaultPrompt = "Bu metni açıkla ve önemli noktalarını özetle.";
  executeAiQuery(defaultPrompt);

  promptInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      btnSend.click();
    }
  });

  btnSend.addEventListener("click", () => {
    const customPrompt = promptInput.value.trim();
    if (customPrompt) {
      responseBox.textContent = "Cevap üretiliyor...";
      executeAiQuery(customPrompt);
      promptInput.value = ""; // Bir sonraki soru için inputu temizle
    }
  });
}

// ─── YAPAY ZEKA METIN BİÇİMLENDİRİCİ (MARKDOWN TO HTML) ─────────
function formatMarkdown(text) {
  if (!text) return "";
  
  // XSS Güvenliği için HTML kaçış karakterleri uygulanır
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Kalın yazıları biçimlendirme (**yazı** veya __yazı__)
  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__(.*?)__/g, "<strong>$1</strong>");

  // İtalik yazıları biçimlendirme (*yazı* veya _yazı_)
  html = html.replace(/\*(.*?)\*/g, "<em>$1</em>");
  html = html.replace(/_(.*?)_/g, "<em>$1</em>");

  // Liste elemanları (* veya - ile başlayan satırlar)
  const lines = html.split("\n");
  let inList = false;
  const processedLines = lines.map(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith("* ") || trimmed.startsWith("- ")) {
      let content = trimmed.substring(2);
      let listHtml = "";
      if (!inList) {
        inList = true;
        listHtml += "<ul style='margin-left: 18px; margin-bottom: 10px; list-style-type: disc; padding-left: 5px;'>";
      }
      listHtml += `<li style='margin-bottom: 6px;'>${content}</li>`;
      return listHtml;
    } else {
      let listHtml = "";
      if (inList) {
        inList = false;
        listHtml += "</ul>";
      }
      if (trimmed.length > 0) {
        return listHtml + `<p style='margin-bottom: 10px; line-height: 1.65;'>${line}</p>`;
      }
      return listHtml;
    }
  });
  
  let finalHtml = processedLines.join("\n");
  if (inList) {
    finalHtml += "</ul>";
  }
  return finalHtml;
}

// ─── GÜVENLİ VEKİL SUNUCU YAPAY ZEKA İNTEGRASYONU (OTOMATİK FALLBACK DESTEKLİ) ───
async function callGeminiAPI(userPrompt, contextText) {
  try {
    // 1. Önce güvenli vekil sunucuya bağlanmayı dene
    const res = await fetch(
      `${BACKEND_URL}/api/query-gemini`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: userPrompt,
          context: contextText
        })
      }
    );

    if (res.ok) {
      const data = await res.json();
      return data.answer;
    }
    console.warn("Vekil sunucu hata döndü, doğrudan Gemini API'ye bağlanılıyor...");
  } catch (err) {
    // Sunucu kapalıysa (Failed to fetch) veya yerelde Node kurulu değilse doğrudan Gemini'a git!
    console.log("Vekil sunucu aktif değil, doğrudan Gemini API'ye bağlanılıyor...");
  }

  // 2. Doğrudan Gemini API Fallback (Sıfır Kurulum Deneyimi)
  const fullPrompt = `Kullanıcı Sorusu: ${userPrompt}\n\nİlgili Metin:\n"""\n${contextText}\n"""\n\nLütfen yukarıdaki metne göre soruyu Türkçe olarak çok akıcı, anlaşılır ve detaylı bir şekilde açıkla. Önemli maddeleri kalın veya listeler halinde sun.`;

  const resDirect = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_FALLBACK_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: fullPrompt
          }]
        }]
      })
    }
  );

  if (!resDirect.ok) {
    const errText = await resDirect.text();
    console.error("Gemini API Hata Yanıtı:", errText);
    throw new Error(`Gemini API Bağlantı Hatası: ${resDirect.status}`);
  }

  const dataDirect = await resDirect.json();
  const answerDirect = dataDirect.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!answerDirect) {
    throw new Error("Gemini API'den boş veya geçersiz yanıt alındı.");
  }
  return answerDirect;
}

// ─── PANOYA KOPYALAMA YARDIMCISI ────────────────────────────
function copyTextToClipboard(text, btnElement) {
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    const originalText = btnElement.innerHTML;
    btnElement.innerHTML = "✅ Kopyalandı!";
    btnElement.style.color = "#4ade80"; // Premium yeşil renk
    setTimeout(() => {
      btnElement.innerHTML = originalText;
      btnElement.style.color = "";
    }, 1500);
  }).catch(err => {
    console.error("Panoya kopyalama hatası:", err);
  });
}

// ─── DİNAMİK REKLAM VE ÇEREZ ENGELLEYİCİ (ADBLOCK ENGINE) ──────
function removeClutter() {
  const clutterSelectors = [
    // Genel Reklam Kapsayıcıları & Google Adsense
    ".adsbygoogle", "[class*='adsbygoogle']", "iframe[src*='googleads']", "iframe[id*='google_ads']",
    "[id*='google_ads']", "[class*='advertising']", "[class*='banner-ads']", ".ad-container",
    ".ad-box", "[class*='ad-unit']", "[id*='div-gpt-ad']", "[class*='sponsored-post']",
    "amp-embed[type='taboola']", "amp-ad", "[id*='taboola']", "[class*='taboola']", "[id*='outbrain']",
    "[class*='outbrain']", ".sidebar-ad", "#sidebar-ad", ".banner-ad", "#banner-ad", ".header-ad", ".footer-ad",
    // Çerez / GDPR Bilgilendirme ve Onay Pencereleri (Consent Banners)
    "[class*='cookie-consent']", "[id*='cookie-consent']", "[class*='cookie-banner']",
    "[id*='cookie-banner']", "[class*='cookie-law']", "#cookie-notice", ".consent-banner",
    "#consent-banner", ".banner-consent", ".cc-banner", ".cc-window", ".cmp-consent-container",
    // Ekranı Kapatan Abonelik / Reklam Katmanları (Subscription Popups / Paywall overlays)
    ".sp-fancybox-iframe", ".fancybox-overlay", ".subscription-overlay", ".paywall-overlay"
  ];

  let count = 0;
  clutterSelectors.forEach(sel => {
    try {
      document.querySelectorAll(sel).forEach(el => {
        el.remove();
        count++;
      });
    } catch (e) {}
  });

  // Eğer reklam engelleme yüzünden gövde kaydırması (scrolling) kilitlendiyse kilidi aç
  try {
    const bodyStyle = window.getComputedStyle(document.body);
    if (bodyStyle.overflow === "hidden" || document.body.style.overflow === "hidden") {
      document.body.style.setProperty("overflow", "auto", "important");
    }
    const htmlStyle = window.getComputedStyle(document.documentElement);
    if (htmlStyle.overflow === "hidden" || document.documentElement.style.overflow === "hidden") {
      document.documentElement.style.setProperty("overflow", "auto", "important");
    }
  } catch (e) {}
}

// Reklam ve çerez popuplarını anında ve periyodik olarak temizle
setTimeout(removeClutter, 300);
setInterval(removeClutter, 1500);
