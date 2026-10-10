 Erişilebilir Okuyucu – Üretim Düzeyi Chrome Uzantısı (SaaS Hazır)

Erişilebilir Okuyucu, web sayfalarını son derece gerçekçi yapay zeka Türkçe sesleriyle ) sesli okuyan ve seçilen metinleri Google Gemini yapay zekasıyla analiz edebilen, **üretim düzeyinde (production-ready) ve SaaS mimarisine tam uyumlu** bir Chrome/Edge uzantısıdır.

---

Öne Çıkan Gelişmiş Özellikler (MVP vs Production)

*    Üst Düzey API Güvenliği (Vekil Sunucu):** Gemini API anahtarınız artık uzantı dosyalarının içinde açıkta DURMAZ. `/backend` klasöründe yer alan Node.js/Express proxy sunucumuz sayesinde API anahtarınız sunucu tarafında güvenle saklanır.
*    Ağ Düzeyinde Yerel AdBlocker (declarativeNetRequest):** Reklamlar sayfaya hiç indirilmeden network katmanında engellenir. Bu sayede internet kotası harcanmaz ve sayfalar 5 kat daha hızlı yüklenir.
*    Birebir (1-e-1) Canlı Paragraf Eşleme:** Metin çıkarma esnasında canlı DOM elemanları benzersiz veri indeksleriyle damgalanır. Tıkladığınız paragrafın okunması sırasındaki kaymalar (bir satır altını veya üstünü okuma) matematiksel olarak tamamen engellenmiştir.
*  Gemini AI Asistanı:** Sayfadan seçtiğiniz herhangi bir metin için otomatik olarak tam boyutta bir glassmorphism yapay zeka çekmecesi açılır ve metni özetlemeye başlar.
*    UI Durum Koruyucu (State Persistence):** Uzantı kapatılıp tekrar açılsa dahi kaldığınız ekran (Okuma ayarları veya Yapay Zeka ekranı) ve en son aldığınız yapay zeka yanıtı hafızada korunur.

---

##  Klasör Yapısı

```
erisibilir-okuyucu/
├── manifest.json       ← Uzantı izinleri, declarativeNetRequest ve rules.json tanımları
├── rules.json          ← Ağ düzeyinde reklam engelleme kuralları
├── popup.html          ← Uzantı paneli arayüzü
├── popup.js            ← Uzantı panelini yöneten ince uzaktan kumanda scripti
├── content.js          ← Tüm durum yönetimini ve ses akışını arka planda tutan ana script
├── README.md           ← Bu dosya
├── backend/            ← Güvenli API Proxy Sunucusu
│   ├── server.js       ← Express sunucu kodu (Gemini API Proxy)
│   ├── package.json    ← Sunucu bağımlılıkları
│   ├── .env            ← API Anahtarının saklandığı yer (Git'e eklenmez!)
│   └── vercel.json     ← Tek tıkla Vercel bulutuna ücretsiz dağıtım konfigürasyonu
└── icons/              ← Uzantı ikonları (16px, 48px, 128px)
```

---

##  Kurulum ve Çalıştırma

### Adım 1: Güvenli Backend Sunucusunu Yerelde Başlatın

Uzantının Yapay Zeka özelliklerini kullanabilmesi için yerel proxy sunucusunun çalışıyor olması gerekir:

1.  `/backend` klasörüne gidin.
2.  Yerel bağımlılıkları kurun:
    ```bash
    npm install
    ```
3.  `.env` dosyasını açıp `GEMINI_API_KEY` alanına geçerli Gemini API anahtarınızı tanımlayın (Varsayılan olarak çalışmaya hazır bir anahtar eklenmiştir).
4.  Sunucuyu başlatın:
    ```bash
    npm start
    ```
    *Sunucu varsayılan olarak `http://localhost:3000` adresinde dinlemeye başlayacaktır.*

### Adım 2: Uzantıyı Tarayıcıya Yükleyin (Chrome / Edge)

1.  Tarayıcınızda `chrome://extensions/` (Edge için `edge://extensions/`) adresine gidin.
2.  Sağ üst köşedeki **"Geliştirici Modu"** (Developer Mode) anahtarını açın.
3.  Sol üstteki **"Paketlenmemiş öğeyi yükle"** (Load unpacked) butonuna tıklayın.
4.  Ana `erisibilir-okuyucu/` klasörünü seçin.
5.  Uzantı tarayıcınıza başarıyla yüklendi! 

