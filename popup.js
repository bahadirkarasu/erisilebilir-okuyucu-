// ─── ARAYÜZ ELEMENTLERİ ─────────────────────────────────────
const statusBox        = document.getElementById("statusBox");
const btnOku           = document.getElementById("btnOku");
const btnDur           = document.getElementById("btnDur");
const btnGeri          = document.getElementById("btnGeri");
const btnIleri         = document.getElementById("btnIleri");
const btnReadMode      = document.getElementById("btnReadMode");
const themeToggle      = document.getElementById("themeToggle");
const fontSizeSlider   = document.getElementById("fontSize");
const lineHeightSlider = document.getElementById("lineHeight");
const readSpeedSlider  = document.getElementById("readSpeed");
const fontSizeVal      = document.getElementById("fontSizeVal");
const lineHeightVal    = document.getElementById("lineHeightVal");
const readSpeedVal     = document.getElementById("readSpeedVal");

// AI Arayüz Elemanları (AI butonu popup'tan kaldırıldı — sayfadaki yan panel kullanılıyor)
const popupSelectedText = document.getElementById("popupSelectedText");
const popupAiPrompt     = document.getElementById("popupAiPrompt");
const btnPopupAiSend    = document.getElementById("btnPopupAiSend");
const popupAiResponse   = document.getElementById("popupAiResponse");

// Yeni Eklenen Ses ve Kopyalama Elemanları
const voiceSelect       = document.getElementById("voiceSelect");
const currentVoiceLabel = document.getElementById("currentVoiceLabel");
const btnCopySelected   = document.getElementById("btnCopySelected");
const btnCopyResponse   = document.getElementById("btnCopyResponse");

// ─── UZANTI PANELİ DURUM YÖNETİMİ ───────────────────────────
let isPlaying = false;
let currentPara = -1;
let readingMode = false;

// Sayfa ile haberleşmeyi kolaylaştıran yardımcı fonksiyon
function sendToContent(action, payload = {}, callback = null) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) {
      if (callback) callback({ error: "Aktif sekme bulunamadı" });
      return;
    }
    chrome.tabs.sendMessage(tabs[0].id, { action, ...payload }, (response) => {
      if (chrome.runtime.lastError) {
        if (callback) callback({ error: chrome.runtime.lastError.message });
      } else {
        if (callback) callback(response);
      }
    });
  });
}

// ─── İÇERİK DURUMU İLE SENKRONİZASYON ───────────────────────
function syncWithContentState() {
  sendToContent("getState", {}, (response) => {
    if (response && response.state) {
      updatePopupUI(response.state);
    } else {
      setStatus("Sayfaya bağlanılamadı. Lütfen sayfayı yenileyin.", "error");
    }
  });
}

// İçerik scriptinden gelen anlık durum güncellemelerini dinle
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "stateUpdated" && msg.state) {
    updatePopupUI(msg.state);
  }
});

// Arayüz elemanlarını gelen yeni duruma göre güncelle
function updatePopupUI(s) {
  isPlaying = s.isPlaying;
  currentPara = s.currentPara;
  readingMode = s.readingModeActive;

  // Oku butonu aktiflik/pasiflik sınıfı
  btnOku.classList.toggle("active", isPlaying);
  btnReadMode.classList.toggle("on", readingMode);

  // Durum mesajı
  if (isPlaying) {
    setStatus(`▶ Okunuyor (${s.currentPara + 1}/${s.totalParas})`, "playing");
  } else if (s.currentPara !== -1) {
    setStatus(`⏸ Durduruldu — ${s.currentPara + 1}. paragraf`, "stopped");
  } else {
    setStatus("Hazır", "");
  }

  // Kaydırıcıların (slider) konumlarını güncelle
  fontSizeSlider.value = s.fontSize;
  fontSizeVal.textContent = s.fontSize + "px";

  lineHeightSlider.value = Math.round(s.lineHeight * 10);
  lineHeightVal.textContent = s.lineHeight.toFixed(1);

  readSpeedSlider.value = Math.round(s.readSpeed * 10);
  readSpeedVal.textContent = s.readSpeed.toFixed(1) + "x";

  // Geri / İleri buton durumları
  btnGeri.classList.toggle("active", s.currentPara > 0);
  btnIleri.classList.toggle("active", s.totalParas > 0 && s.currentPara < s.totalParas - 1);

  // Temayı gövde sınıfına ekle/çıkar
  document.body.classList.toggle("light", s.isLight);
}

function setStatus(msg, cls = "") {
  statusBox.innerHTML = msg;
  statusBox.className = "status-box " + cls;
}

// ─── ARAYÜZ ETKİLEŞİM DİNLEYİCİLERİ ──────────────────────────
btnOku.addEventListener("click", () => {
  sendToContent("cmdPlay");
});

btnDur.addEventListener("click", () => {
  sendToContent("cmdPause");
});

btnGeri.addEventListener("click", () => {
  sendToContent("cmdPrev");
});

btnIleri.addEventListener("click", () => {
  sendToContent("cmdNext");
});

btnReadMode.addEventListener("click", () => {
  readingMode = !readingMode;
  sendToContent("cmdToggleReadMode", { enabled: readingMode });
});

fontSizeSlider.addEventListener("input", () => {
  const v = fontSizeSlider.value;
  fontSizeVal.textContent = v + "px";
  chrome.storage.local.set({ fontSize: v });
  sendToContent("cmdSetFontSize", { value: v });
});

lineHeightSlider.addEventListener("input", () => {
  const v = lineHeightSlider.value;
  lineHeightVal.textContent = (v / 10).toFixed(1);
  chrome.storage.local.set({ lineHeight: v });
  sendToContent("cmdSetLineHeight", { value: (v / 10).toFixed(1) });
});

readSpeedSlider.addEventListener("input", () => {
  const v = readSpeedSlider.value;
  const speed = v / 10;
  readSpeedVal.textContent = speed.toFixed(1) + "x";
  chrome.storage.local.set({ readSpeed: v });
  sendToContent("cmdSetSpeed", { value: speed });
});

themeToggle.addEventListener("click", () => {
  const isLightNow = !document.body.classList.contains("light");
  document.body.classList.toggle("light", isLightNow);
  chrome.storage.local.set({ isLight: isLightNow });
  sendToContent("cmdToggleTheme", { isLight: isLightNow });
});

// ─── POPUP YAPAY ZEKA ASİSTANI VE UI DURUM KORUMASI ──────────
// NOT: AI'a Sor butonu popup'tan kaldırıldı. AI işlemleri sayfadaki
//      "🪄 AI'a Sor" kayan buton → sağ panel akışı üzerinden yürütülüyor.
function savePopupScreenState() {
  chrome.storage.local.set({
    popupSelectedText: popupSelectedText ? popupSelectedText.textContent : "",
    popupAiPrompt:     popupAiPrompt     ? popupAiPrompt.value           : "",
    popupAiResponse:   popupAiResponse   ? popupAiResponse.innerHTML     : ""
  });
}

// Sayfadaki seçili metni içerik scriptinden al
async function getSelectedTextFromPage() {
  return new Promise((resolve) => {
    sendToContent("getSelectedText", {}, (resp) => {
      resolve(resp?.text || "");
    });
  });
}

// Yapay Zekaya Sor (Gönder)
btnPopupAiSend.addEventListener("click", () => {
  const prompt = popupAiPrompt.value.trim();
  const context = popupSelectedText.textContent.trim();
  if (!prompt || context.startsWith("Sayfada seçili metin bulunamadı")) return;

  popupAiResponse.textContent = "Cevap üretiliyor...";
  savePopupScreenState();
  triggerGeminiQuery(prompt, context);
});

function triggerGeminiQuery(prompt, context) {
  btnPopupAiSend.disabled = true;
  sendToContent("queryGemini", { prompt, context }, (resp) => {
    btnPopupAiSend.disabled = false;
    if (resp && resp.error) {
      popupAiResponse.innerHTML = `<span style='color: #f87171;'>Hata: ${resp.error}</span>`;
    } else {
      popupAiResponse.innerHTML = formatMarkdown(resp?.answer || "Cevap alınamadı.");
    }
    savePopupScreenState();
  });
}

// Girdi kutusundaki değişiklikleri otomatik kaydet
popupAiPrompt.addEventListener("input", savePopupScreenState);

// YAPAY ZEKA YANIT BİÇİMLENDİRİCİ (MARKDOWN TO HTML)
function formatMarkdown(text) {
  if (!text) return "";
  
  // HTML Kaçış karakterleri (XSS Önlemi)
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Kalın yazı dönüşümleri
  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__(.*?)__/g, "<strong>$1</strong>");

  // İtalik yazı dönüşümleri
  html = html.replace(/\*(.*?)\*/g, "<em>$1</em>");
  html = html.replace(/_(.*?)_/g, "<em>$1</em>");

  // Liste ve paragraf dönüşümleri
  const lines = html.split("\n");
  let inList = false;
  const processedLines = lines.map(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith("* ") || trimmed.startsWith("- ")) {
      let content = trimmed.substring(2);
      let listHtml = "";
      if (!inList) {
        inList = true;
        listHtml += "<ul style='margin-left: 14px; margin-bottom: 8px; list-style-type: disc; padding-left: 5px;'>";
      }
      listHtml += `<li style='margin-bottom: 4px;'>${content}</li>`;
      return listHtml;
    } else {
      let listHtml = "";
      if (inList) {
        inList = false;
        listHtml += "</ul>";
      }
      if (trimmed.length > 0) {
        return listHtml + `<p style='margin-bottom: 8px; line-height: 1.5;'>${line}</p>`;
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

// ─── SES LİSTELEME VE SEÇME FONKSİYONLARI ───────────────────
function updateVoiceLabel(voiceName) {
  if (!currentVoiceLabel) return;
  if (!voiceName) {
    currentVoiceLabel.textContent = "Varsayılan Ses ile";
    return;
  }
  if (voiceName === "ElevenLabs_ErgunKalbak") {
    currentVoiceLabel.textContent = "Ergun Kalbak (ElevenLabs) sesiyle";
    return;
  }
  if (voiceName === "ElevenLabs_IremHanim") {
    currentVoiceLabel.textContent = "İrem Özdemir (ElevenLabs) sesiyle";
    return;
  }
  if (voiceName.startsWith("ElevenLabs_")) {
    const option = Array.from(voiceSelect.options).find(opt => opt.value === voiceName);
    if (option) {
      currentVoiceLabel.textContent = option.textContent.replace("👑 ", "") + " sesiyle";
    } else {
      currentVoiceLabel.textContent = "ElevenLabs sesiyle";
    }
    return;
  }
  let cleanName = voiceName
    .replace("Microsoft ", "")
    .replace("Online (Natural)", "Natural")
    .replace("Desktop - ", "");
  currentVoiceLabel.textContent = cleanName + " sesiyle";
}

function populateVoiceList() {
  if (typeof speechSynthesis === "undefined" || !voiceSelect) return;
  
  const voices = speechSynthesis.getVoices();
  const trVoices = voices.filter(v => v.lang.startsWith("tr"));
  
  sendToContent("getElevenLabsVoices", {}, (response) => {
    const elevenVoices = (response && response.voices) ? response.voices : [];
    
    voiceSelect.innerHTML = "";
    
    // 1. ElevenLabs Seslerini ekle
    if (elevenVoices.length > 0) {
      elevenVoices.forEach(voice => {
        const option = document.createElement("option");
        option.textContent = `👑 ${voice.name} (ElevenLabs)`;
        option.value = `ElevenLabs_${voice.voice_id}`;
        voiceSelect.appendChild(option);
      });
    } else {
      const elevenOption1 = document.createElement("option");
      elevenOption1.textContent = "👑 Ergun Kalbak (ElevenLabs)";
      elevenOption1.value = "ElevenLabs_ErgunKalbak";
      voiceSelect.appendChild(elevenOption1);

      const elevenOption2 = document.createElement("option");
      elevenOption2.textContent = "👑 İrem Özdemir (ElevenLabs)";
      elevenOption2.value = "ElevenLabs_IremHanim";
      voiceSelect.appendChild(elevenOption2);
    }
    
    // 2. Sistem Türkçe seslerini ekle
    trVoices.forEach(voice => {
      const option = document.createElement("option");
      let displayName = voice.name;
      if (voice.name.includes("Natural")) {
        displayName = "✨ " + displayName.replace("Microsoft ", "").replace("Online (Natural)", "Natural");
      } else if (voice.name.includes("Google")) {
        displayName = "🌐 " + displayName;
      } else {
        displayName = "🗣️ " + displayName.replace("Microsoft ", "").replace("Desktop - ", "");
      }
      option.textContent = displayName;
      option.value = voice.name;
      voiceSelect.appendChild(option);
    });
    
    // Seçili sesi geri yükle
    chrome.storage.local.get(["selectedVoice"], (data) => {
      if (data.selectedVoice) {
        const exists = Array.from(voiceSelect.options).some(opt => opt.value === data.selectedVoice);
        if (exists) {
          voiceSelect.value = data.selectedVoice;
          updateVoiceLabel(data.selectedVoice);
        } else {
          const defaultVal = voiceSelect.options[0]?.value || "";
          voiceSelect.value = defaultVal;
          updateVoiceLabel(defaultVal);
        }
      } else {
        const defaultVal = voiceSelect.options[0]?.value || "";
        voiceSelect.value = defaultVal;
        chrome.storage.local.set({ selectedVoice: defaultVal });
        sendToContent("cmdSetVoice", { value: defaultVal });
        updateVoiceLabel(defaultVal);
      }
    });
  });
}

// Ses değişimi olay dinleyicisi
if (voiceSelect) {
  voiceSelect.addEventListener("change", () => {
    const selectedVoice = voiceSelect.value;
    chrome.storage.local.set({ selectedVoice });
    sendToContent("cmdSetVoice", { value: selectedVoice });
    updateVoiceLabel(selectedVoice);
  });
}

if (typeof speechSynthesis !== "undefined") {
  speechSynthesis.onvoiceschanged = populateVoiceList;
  // İlk yüklemede de çalıştırmayı dene
  populateVoiceList();
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

// ─── İLK AÇILIŞTA DURUMU YÜKLE ──────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // 1. Ses listesini tekrar kontrol et ve doldur
  populateVoiceList();

  // 2. Depolanmış AI içerik durumunu yükle
  chrome.storage.local.get(
    ["popupSelectedText", "popupAiPrompt", "popupAiResponse"],
    (data) => {
      if (data.popupSelectedText && popupSelectedText) {
        popupSelectedText.textContent = data.popupSelectedText;
      }
      if (data.popupAiPrompt && popupAiPrompt) {
        popupAiPrompt.value = data.popupAiPrompt;
      }
      if (data.popupAiResponse) {
        popupAiResponse.innerHTML = data.popupAiResponse;
      }
    }
  );

  // 3. Kopyalama Butonlarını Etkinleştir
  if (btnCopySelected) {
    btnCopySelected.addEventListener("click", () => {
      copyTextToClipboard(popupSelectedText.textContent.trim(), btnCopySelected);
    });
  }
  
  if (btnCopyResponse) {
    btnCopyResponse.addEventListener("click", () => {
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = popupAiResponse.innerHTML;
      const textToCopy = tempDiv.innerText || tempDiv.textContent;
      copyTextToClipboard(textToCopy.trim(), btnCopyResponse);
    });
  }

  // 4. Sayfa ile canlı durum senkronizasyonunu başlat
  syncWithContentState();
});
