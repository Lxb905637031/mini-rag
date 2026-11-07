"""冒烟测试：应用可构建、统一信封与鉴权守卫行为正确（不依赖外部服务）。"""

from __future__ import annotations


def test_health_envelope(client):
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    # 统一成功信封结构。
    assert body["success"] is True
    assert body["code"] == "OK"
    assert body["message"] == "请求成功"
    assert body["data"]["ok"] is True
    assert set(body["meta"]) >= {"requestId", "timestamp", "path", "durationMs"}
    # 外层契约：no-store + x-request-id 回写。
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-request-id"] == body["meta"]["requestId"]


def test_protected_route_requires_token(client):
    response = client.get("/auth/profile")
    assert response.status_code == 401
    body = response.json()
    assert body["success"] is False
    assert body["code"] == "HTTP_401"
    assert body["message"] == "未登录或登录已失效，请先登录"


def test_validation_error_uses_joined_messages(client):
    response = client.post("/auth/login", json={"username": "ab", "password": "123"})
    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "HTTP_400"
    assert "用户名只能包含 3~32 位字母、数字或下划线" in body["message"]
    assert "密码长度需为 6~64 位" in body["message"]


def test_chat_stream_requires_token(client):
    response = client.post(
        "/chat/query/stream",
        json={"knowledgeBaseId": "any", "query": "你好"},
    )
    assert response.status_code == 401
    body = response.json()
    assert body["code"] == "HTTP_401"
