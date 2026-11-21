#pragma once

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <time.h>
#include "config.h"

// O corpo nunca é registrado: respostas de descoberta e retirada contêm segredos.
inline int apiRequest(const char* path, const char* header, const String& credential,
                      const JsonDocument* payload, JsonDocument* result = nullptr) {
  if (WiFi.status() != WL_CONNECTED || !API_ROOT_CA[0] || time(nullptr) < 1704067200)
    return -1;

  WiFiClientSecure tls;
  tls.setCACert(API_ROOT_CA);
  tls.setHandshakeTimeout(5);
  HTTPClient http;
  http.setConnectTimeout(5000);
  http.setTimeout(5000);
  String url = String("https://") + API_HOST + ":" + API_PORT + path;
  if (!http.begin(tls, url)) return -1;
  http.addHeader(header, credential);
  int status;
  if (payload) {
    String body;
    serializeJson(*payload, body);
    http.addHeader("Content-Type", "application/json");
    status = http.POST(body);
  } else {
    status = http.GET();
  }
  if (result && status >= 200 && status < 300 &&
      deserializeJson(*result, http.getString()) != DeserializationError::Ok) {
    status = -1;
  }
  http.end();
  return status;
}
