@echo off
title Erisilebilir Okuyucu Sunucu Baslatici
echo =======================================================
echo   Erisilebilir Okuyucu Guvenli Sunucusu Baslatiliyor...
echo =======================================================
echo.
cd /d "%~dp0backend"
echo [1/2] Gerekli paketler kontrol ediliyor ve yukleniyor...
call npm install
echo.
echo [2/2] Sunucu baslatiliyor...
echo.
node server.js
pause
