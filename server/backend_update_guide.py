# -*- coding: utf-8 -*-
import json
import os
import requests
import oss2

"""
阿里云函数计算 (FC) 代码更新指南
该代码旨在替换或合并到您现有的阿里云函数处理逻辑中，
以支持 /stats 路由的数据存储与读取。

前置条件：
1. 您需要有一个阿里云 OSS Bucket 用于存储 JSON 数据（因为函数计算是无状态的）。
2. 需要配置环境变量：
   - OSS_ACCESS_KEY_ID
   - OSS_ACCESS_KEY_SECRET
   - OSS_ENDPOINT (例如: oss-cn-hangzhou.aliyuncs.com)
   - OSS_BUCKET_NAME (存储统计数据的 Bucket 名称)
   - DASHSCOPE_API_KEY (您原有的通义千问 Key，保持不变)
"""

# OSS 配置（建议通过环境变量获取）
ACCESS_KEY_ID = os.environ.get('OSS_ACCESS_KEY_ID')
ACCESS_KEY_SECRET = os.environ.get('OSS_ACCESS_KEY_SECRET')
OSS_ENDPOINT = os.environ.get('OSS_ENDPOINT', 'oss-cn-hangzhou.aliyuncs.com')
BUCKET_NAME = os.environ.get('OSS_BUCKET_NAME')
STATS_FILE_NAME = 'global_user_stats.json'

def get_bucket():
    if not all([ACCESS_KEY_ID, ACCESS_KEY_SECRET, BUCKET_NAME]):
        return None
    auth = oss2.Auth(ACCESS_KEY_ID, ACCESS_KEY_SECRET)
    return oss2.Bucket(auth, OSS_ENDPOINT, BUCKET_NAME)

def handler(environ, start_response):
    # 1. 路由解析
    path = environ.get('PATH_INFO', '/')
    method = environ.get('REQUEST_METHOD', 'GET')
    
    # 2. 跨域头设置 (CORS)
    headers = [
        ('Content-Type', 'application/json'),
        ('Access-Control-Allow-Origin', '*'),
        ('Access-Control-Allow-Methods', 'POST, GET, OPTIONS'),
        ('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    ]

    # 3. 处理 OPTIONS 预检请求
    if method == 'OPTIONS':
        start_response('204 No Content', headers)
        return []

    # 4. 路由分支：/stats (新增逻辑)
    if path == '/stats':
        bucket = get_bucket()
        if not bucket:
            start_response('500 Internal Server Error', headers)
            return [json.dumps({"error": "OSS config missing"}).encode('utf-8')]

        # GET /stats: 读取全量统计数据
        if method == 'GET':
            try:
                # 尝试从 OSS 读取文件
                if not bucket.object_exists(STATS_FILE_NAME):
                    data = [] # 文件不存在则返回空列表
                else:
                    obj = bucket.get_object(STATS_FILE_NAME)
                    data = json.load(obj)
                
                start_response('200 OK', headers)
                return [json.dumps(data).encode('utf-8')]
            except Exception as e:
                start_response('500 Internal Server Error', headers)
                return [json.dumps({"error": str(e)}).encode('utf-8')]

        # POST /stats: 接收单条用户数据并合并
        elif method == 'POST':
            try:
                # 读取请求体
                request_body_size = int(environ.get('CONTENT_LENGTH', 0))
                request_body = environ['wsgi.input'].read(request_body_size)
                new_stat = json.loads(request_body)
                
                # 1. 读取现有数据
                if bucket.object_exists(STATS_FILE_NAME):
                    current_data = json.load(bucket.get_object(STATS_FILE_NAME))
                else:
                    current_data = []

                # 2. 合并逻辑 (按 username 更新)
                updated = False
                for i, stat in enumerate(current_data):
                    if stat.get('username') == new_stat.get('username'):
                        # 简单的合并策略：取 lastActiveTimestamp 最新的
                        if new_stat.get('lastActiveTimestamp', 0) > stat.get('lastActiveTimestamp', 0):
                            current_data[i] = new_stat
                        updated = True
                        break
                
                if not updated:
                    current_data.append(new_stat)

                # 3. 写回 OSS
                bucket.put_object(STATS_FILE_NAME, json.dumps(current_data))

                start_response('200 OK', headers)
                return [json.dumps({"status": "updated"}).encode('utf-8')]

            except Exception as e:
                start_response('500 Internal Server Error', headers)
                return [json.dumps({"error": str(e)}).encode('utf-8')]

    # 5. 原有逻辑：通义千问代理 (保持不变)
    # 假设之前的逻辑是处理根路径 / 或其他路径的 AI 请求
    # ... (此处保留您原有的调用 dashscope 的代码) ...
    
    # 示例：如果不是 /stats，则走原有 AI 处理流程
    # 下面是一个简单的回退示例，实际请保留您原来的代码
    if method == 'POST':
        try:
            # 这里应为您原有的调用通义千问的代码
            # ...
            start_response('200 OK', headers)
            return [json.dumps({"message": "Original AI logic here"}).encode('utf-8')]
        except Exception as e:
            start_response('500 Internal Server Error', headers)
            return [json.dumps({"error": str(e)}).encode('utf-8')]

    start_response('404 Not Found', headers)
    return [json.dumps({"error": "Route not found"}).encode('utf-8')]
