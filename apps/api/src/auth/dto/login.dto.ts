/**
 * @file apps/api/src/auth/dto/login.dto.ts
 * @description 登录接口 POST /auth/login 的请求体 DTO（数据传输对象）与校验规则。
 *
 * 小白导读：
 * - DTO 用 class + class-validator 装饰器描述“请求体必须长什么样”；
 * - main.ts 里的全局 ValidationPipe 会在请求进入控制器前自动校验，
 *   不合法直接返回 400，控制器代码里就不用再手写一堆 if 判断。
 * - 这里的规则是“前后端契约”，前端登录表单的校验规则要与之一致。
 */
import { IsNotEmpty, IsString, Length, Matches } from 'class-validator'

/** 登录请求体：用户名 + 密码。 */
export class LoginDto {
  // 用户名：必填字符串，只允许 3~32 位的字母、数字、下划线。
  // Matches 的正则不通过时，用 message 返回中文提示（覆盖英文默认文案）。
  @IsString()
  @IsNotEmpty({ message: '请输入用户名' })
  @Matches(/^[a-zA-Z0-9_]{3,32}$/, {
    message: '用户名只能包含 3~32 位字母、数字或下划线',
  })
  username!: string

  // 密码：必填字符串，长度 6~64 位。
  @IsString()
  @IsNotEmpty({ message: '请输入密码' })
  @Length(6, 64, { message: '密码长度需为 6~64 位' })
  password!: string
}
