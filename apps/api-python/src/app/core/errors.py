"""业务异常：对齐 NestJS 的 HttpException 体系。

Node 版全局异常过滤器 (api-exception.filter.ts) 的映射规则：
  - HTTP 状态码取异常自带 status；
  - message 取构造时传入的中文提示；
  - code 默认为 "HTTP_<status>"（异常体没有自定义字符串 code 时）；
  - error.type 用 NestJS 异常类名（BadRequestException / NotFoundException ...）。
这里用 ApiException 复刻同样的行为。
"""

from __future__ import annotations

# HTTP 状态码 → NestJS 异常类名（仅用于错误响应里的 error.type 字段，前端不依赖它）。
NEST_EXCEPTION_NAMES = {
    400: "BadRequestException",
    401: "UnauthorizedException",
    403: "ForbiddenException",
    404: "NotFoundException",
    409: "ConflictException",
    413: "PayloadTooLargeException",
    415: "UnsupportedMediaTypeException",
    422: "UnprocessableEntityException",
    429: "HttpException",
    500: "InternalServerErrorException",
}


class ApiException(Exception):
    """带 HTTP 状态码与展示文案的业务异常，等价于 NestJS 的 XxxException(message)。"""

    def __init__(self, status_code: int, message: str, *, code: str | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message
        self.code = code

    @property
    def name(self) -> str:
        return NEST_EXCEPTION_NAMES.get(self.status_code, "HttpException")


def bad_request(message: str) -> ApiException:
    return ApiException(400, message)


def unauthorized(message: str = "Unauthorized") -> ApiException:
    return ApiException(401, message)


def forbidden(message: str = "Forbidden") -> ApiException:
    return ApiException(403, message)


def not_found(message: str = "Not Found") -> ApiException:
    return ApiException(404, message)


def conflict(message: str) -> ApiException:
    return ApiException(409, message)


def payload_too_large(message: str) -> ApiException:
    return ApiException(413, message)
