#!/bin/bash
# 构建脚本：将环境变量注入到 script.js

if [ -n "$API_BASE_URL" ]; then
  sed -i "s|__API_BASE_URL__|$API_BASE_URL|g" script.js
  echo "API_BASE_URL 已注入: $API_BASE_URL"
else
  echo "警告: API_BASE_URL 环境变量未设置"
fi
