"""认证 DTO：对齐 auth/dto/{login,register}.dto.ts 的校验规则与中文报错文案。"""

from __future__ import annotations

import re

from pydantic import BaseModel, ConfigDict, field_validator

USERNAME_RE = re.compile(r"^[a-zA-Z0-9_]{3,32}$")


class LoginDto(BaseModel):
    model_config = ConfigDict(extra="ignore")

    username: str
    password: str

    @field_validator("username")
    @classmethod
    def _username(cls, value: str) -> str:
        if not value:
            raise ValueError("请输入用户名")
        if not USERNAME_RE.fullmatch(value):
            raise ValueError("用户名只能包含 3~32 位字母、数字或下划线")
        return value

    @field_validator("password")
    @classmethod
    def _password(cls, value: str) -> str:
        if not value:
            raise ValueError("请输入密码")
        if not 6 <= len(value) <= 64:
            raise ValueError("密码长度需为 6~64 位")
        return value


class RegisterDto(LoginDto):
    displayName: str | None = None

    @field_validator("displayName")
    @classmethod
    def _display_name(cls, value: str | None) -> str | None:
        if value is None:
            return value
        if not isinstance(value, str):
            raise ValueError("昵称必须是字符串")
        if not 1 <= len(value) <= 32:
            raise ValueError("昵称长度需为 1~32 个字符")
        return value
