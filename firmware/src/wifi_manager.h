#pragma once

#include <ArduinoJson.h>
#include <WiFi.h>
#include <WiFiManager.h>
#include <esp_system.h>
#include "config.h"

namespace network {
static WiFiManager manager;
static bool triedPortal = false;
static String portalPassword;
static uint32_t startedAt;
static uint32_t lastConnect;
static char serialLine[256];
static size_t serialLength = 0;
static bool discardLine = false;

inline void begin() {
  WiFi.mode(WIFI_STA);
  WiFi.persistent(true);
  WiFi.setAutoReconnect(true);
  WiFi.begin();
  startedAt = lastConnect = millis();
  manager.setDebugOutput(false);
  manager.setConfigPortalBlocking(false);
  manager.setConfigPortalTimeout(WIFI_PORTAL_TIMEOUT_S);
  manager.setConnectTimeout(WIFI_CONNECT_TIMEOUT_S);
  Serial.println("Wi-Fi por USB: envie uma linha JSON com ssid e password a 115200 baud.");
}

inline void serialSetup() {
  while (Serial.available()) {
    const int incoming = Serial.read();
    if (incoming == '\r') continue;
    if (incoming != '\n') {
      if (serialLength < sizeof(serialLine) - 1) serialLine[serialLength++] = char(incoming);
      else discardLine = true;
      continue;
    }
    serialLine[serialLength] = '\0';
    JsonDocument doc;
    const bool valid = !discardLine && !deserializeJson(doc, serialLine) &&
                       doc["ssid"].is<const char*>() && doc["password"].is<const char*>();
    if (valid) {
      String ssid = doc["ssid"].as<String>();
      String password = doc["password"].as<String>();
      if (ssid.length() > 0 && ssid.length() <= 32 && password.length() <= 64) {
        if (manager.getConfigPortalActive()) manager.stopConfigPortal();
        WiFi.persistent(true);
        WiFi.begin(ssid.c_str(), password.c_str());
        lastConnect = millis();
        Serial.println("Tentando conectar ao Wi-Fi configurado via USB.");
      }
    }
    memset(serialLine, 0, sizeof(serialLine));
    serialLength = 0;
    discardLine = false;
  }
}

inline void tick() {
  serialSetup();
  if (manager.getConfigPortalActive()) {
    manager.process();
    return;
  }
  if (WiFi.status() == WL_CONNECTED) return;
  if (!triedPortal && millis() - startedAt >= WIFI_CONNECT_TIMEOUT_S * 1000UL) {
    triedPortal = true;
    // Senha local aleatória por inicialização, apresentada apenas no OLED.
    char password[13];
    snprintf(password, sizeof(password), "%08lx%04lx", static_cast<unsigned long>(esp_random()),
             static_cast<unsigned long>(esp_random() & 0xffff));
    portalPassword = password;
    manager.startConfigPortal(WIFI_PORTAL_SSID, portalPassword.c_str());
    lastConnect = millis();
  } else if (millis() - lastConnect >= 30000UL) {
    WiFi.reconnect();
    lastConnect = millis();
  }
}
}  // namespace network
