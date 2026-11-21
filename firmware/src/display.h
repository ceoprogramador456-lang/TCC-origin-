#pragma once

#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Wire.h>
#include "config.h"

static Adafruit_SSD1306 display(OLED_WIDTH, OLED_HEIGHT, &Wire, -1);
static bool displayReady = false;

inline void setupDisplay() {
  displayReady = display.begin(SSD1306_SWITCHCAPVCC, OLED_I2C_ADDRESS);
  if (!displayReady) Serial.println("Falha ao iniciar o OLED.");
}

inline void drawStatus(float flow, const String& espId, const String& code, const char* message,
                       const String& portalPassword) {
  if (!displayReady) return;
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  if (!portalPassword.isEmpty()) {
    display.println("Configurar Wi-Fi");
    display.println(WIFI_PORTAL_SSID);
    display.println(portalPassword);
    display.println(WiFi.softAPIP());
  } else {
    if (espId.isEmpty()) display.println("SIVA - ESP32");
    else display.println(espId);
    if (WiFi.status() == WL_CONNECTED) {
      display.println(message);
      if (!code.isEmpty()) {
        display.setTextSize(2);
        display.println(code);
      }
    } else {
      display.println("Wi-Fi offline");
    }
  }
  display.setTextSize(1);
  display.printf("%.2f L/min", flow);
  display.display();
}
