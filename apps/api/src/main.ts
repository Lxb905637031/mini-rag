/**
 * main.ts —— 整个 NestJS 后端服务的启动入口
 *
 * 文件作用：
 *   创建并配置 Nest 应用实例（底层是 Express），注册跨域规则、全局管道、
 *   全局响应拦截器和全局异常过滤器，最后监听 HTTP 端口对外提供服务。
 *
 * 在 NestJS 请求生命周期中的位置：入口启动阶段。
 *   进程启动 -> 执行本文件 -> NestFactory 根据 AppModule 完成依赖注入装配
 *   -> 请求进入后依次经过：中间件 -> 守卫 -> 拦截器（前半段）-> 管道（参数校验）
 *   -> 控制器方法 -> 拦截器（后半段，包装返回值）-> 异常过滤器（抛出异常时兜底）。
 *
 * 上下游关系：
 *   上游：Node.js 进程通过 package.json 的启动脚本直接运行本文件。
 *   下游：app.module.ts 根模块聚合所有控制器与服务；
 *         common 目录下的拦截器与过滤器负责统一响应格式。
 *
 * 小白概念：
 *   - 依赖注入（DI）：类不自己 new 依赖对象，而由 Nest 容器在构造时传入。
 *     框架靠装饰器写入的“元数据”知道要注入什么，运行时读取元数据需要
 *     reflect-metadata 这个库，所以它必须在所有业务代码之前第一个导入。
 *   - 全局管道 / 过滤器 / 拦截器：入口处用 useGlobalXxx 注册一次，即对所有
 *     路由生效。管道负责校验和转换入参；拦截器包装成功响应；过滤器统一处理异常。
 *   - 中间件：本文件在 Express 层注册了一个原生中间件，它在路由处理之前执行，
 *     做完自己的事后必须调用 next()，请求才会继续往后走。
 */
// reflect-metadata 只需要在应用入口导入一次，作用是给运行时补充读取装饰器
// 元数据的能力（如 Reflect.getMetadata），NestJS 的依赖注入依赖它，必须放第一行。
import 'reflect-metadata'
import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module.js'
import { ApiExceptionFilter } from './common/api-exception.filter.js'
import { ApiResponseInterceptor } from './common/api-response.interceptor.js'

/**
 * 应用启动函数：完成所有全局配置并开始监听端口。
 * 没有参数，也没有返回值（Promise 在服务持续运行期间不会 resolve）。
 */
async function bootstrap() {
  // 以 AppModule 为根模块创建 Nest 应用，期间容器会实例化所有控制器、服务并注入依赖。
  const app = await NestFactory.create(AppModule)
  // 取出底层真正处理 HTTP 的 Express 实例，以便使用 Express 原生能力。
  const express = app.getHttpAdapter().getInstance()
  // 关闭 Express 默认的 etag 协商缓存，避免前端/代理命中 304 而看不到最新数据。
  express.set('etag', false)
  // 注册一个 Express 全局中间件：给每个响应加上“禁止缓存”的响应头。
  express.use(
    (
      _request: unknown,
      response: { setHeader: (name: string, value: string) => void },
      next: () => void,
    ) => {
      // no-store 告诉浏览器和中间代理：响应内容一律不要存储，每次都向服务器重新请求。
      response.setHeader('Cache-Control', 'no-store')
      // 必须调用 next() 放行，否则请求会一直挂起，不会进入后面的路由处理。
      next()
    },
  )
  // 解析允许跨域访问的前端来源（origin）列表：
  // 优先读环境变量 WEB_ORIGINS（多个地址用英文逗号分隔），其次读旧变量 WEB_ORIGIN，
  // 都没有时回退到 Vite 本地开发服务器地址 http://localhost:5173。
  const configuredOrigins = (
    process.env.WEB_ORIGINS ??
    process.env.WEB_ORIGIN ??
    'http://localhost:5173'
  )
    .split(',') // 按逗号拆成多个地址
    .map(origin => origin.trim()) // 去掉每个地址两端可能存在的空格
    .filter(Boolean) // 去掉空字符串，避免把空来源加入白名单
  // 本地开发时有意允许局域网内任意来源访问（origin: true 会回显请求方的来源并放行），
  // 方便用手机或同一局域网的其它设备调试；生产环境只放行上面明确配置的来源白名单。
  app.enableCors({ origin: process.env.NODE_ENV === 'production' ? configuredOrigins : true })
  // 注册全局校验管道，对所有路由的请求参数生效：
  // whitelist: true 会剥离 DTO 上没有声明的多余字段；
  // transform: true 会按参数类型自动做类型转换（如把查询字符串转成数字）。
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
  // 注册全局成功响应拦截器：把控制器的返回值统一包成 { success, code, message, data, meta }。
  app.useGlobalInterceptors(new ApiResponseInterceptor())
  // 注册全局异常过滤器：任何环节抛出的异常最终都在这里被转成统一的错误 JSON。
  // 注册顺序上拦截器先包外层；一旦控制器抛错，异常会冒泡到过滤器处理。
  app.useGlobalFilters(new ApiExceptionFilter())
  // 开启优雅停机：默认情况下 Nest 不监听 SIGINT/SIGTERM 信号（Ctrl+C 直接硬退），
  // 开启后，进程收到退出信号会先按依赖图逆序调用各服务的 onModuleDestroy——
  // 对本项目而言最关键的是 IngestionWorker 的 worker.close()：它会“停止领取新任务、
  // 等当前索引任务跑完再退”，避免任务做到一半进程消失。必须放在 listen 之前调用。
  app.enableShutdownHooks()
  // 启动 HTTP 监听：端口取环境变量 API_PORT，未配置时默认使用 3001；
  // Number(...) 是因为环境变量读出来永远是字符串，需要转成数字。
  await app.listen(Number(process.env.API_PORT ?? 3001))
}
// bootstrap 是异步函数，这里显式调用但不 await；
// 前面的 void 用来向读者和检查工具表明“有意忽略这个 Promise”，服务将持续运行。
void bootstrap()
