#!/bin/bash

# 配置信息
IMAGE_NAME="lissettecarlr/web-notepad"
VERSION="0.1.2"

# 登录到Docker Hub（首次使用需要）
echo "正在登录Docker Hub..."
docker login

# 构建镜像
echo "正在构建Docker镜像..."
docker build -t $IMAGE_NAME:$VERSION .
docker tag $IMAGE_NAME:$VERSION $IMAGE_NAME:latest

# 推送镜像
echo "正在推送镜像到Docker Hub..."
docker push $IMAGE_NAME:$VERSION
docker push $IMAGE_NAME:latest

echo "完成！镜像已上传到 Docker Hub" 