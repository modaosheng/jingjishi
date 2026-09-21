# Android 发布签名配置指南

> 只在需要构建 **release 包**（用于上架应用商店）时才需要做这件事。
> **只想装到自己手机上测试 → 用 debug 包，本文件不用看。**

---

## 为什么需要签名

Android 要求每个应用包都由开发者签名。签名有两个作用：

1. **证明身份** —— 系统据此确认「这个更新确实来自原来的开发者」
2. **防止篡改** —— 签名后任何修改都会导致校验失败

⚠️ **最重要的一条**：签名文件和密码**一旦丢失，你将永远无法再发布这个应用的更新** ——
只能换一个新的包名（`applicationId`）重新上架，已有的用户无法升级。

**所以 keystore 文件必须长期妥善备份**（建议存两处：加密云盘 + 离线 U 盘）。

---

## 一、生成签名文件（本地执行一次）

需要本机有 JDK（`keytool` 命令）。如果你的电脑没装 Java，可以：
- 在 GitHub Actions 里跑一次生成命令（临时建个 workflow）
- 或让已有 Java 的机器/朋友代生成，然后把 keystore 交给你保管

```bash
keytool -genkeypair -v \
  -keystore release.keystore \
  -alias jingshi \
  -keyalg RSA -keysize 2048 -validity 10000
```

执行过程中会要求输入：

| 提示 | 建议填写 |
| --- | --- |
| 密钥库口令（store password） | **自己设一个强密码，务必记牢** |
| 名字 / 组织 / 城市等 | 可如实填写，也可简略（不会展示给用户） |
| 密钥口令（key password） | 直接回车 = 与密钥库口令相同（推荐，少记一个） |

完成后得到 `release.keystore` 文件。

> `-validity 10000` 约等于 27 年，足够覆盖应用生命周期。
> Google Play 的要求是至少 25 年，所以这个值达标。

---

## 二、转成 base64（用于存进 GitHub Secret）

```bash
# Windows Git Bash / Linux / macOS 通用
base64 -w0 release.keystore > keystore.b64
```

Windows 上如果没有 `-w0`（旧版 coreutils），改用：

```bash
# 生成后需手动去掉换行，否则 Secret 里的值会带换行导致校验失败
certutil -encode release.keystore keystore.b64
```

把 `keystore.b64` 里的内容**整段复制**（它是一行很长的字符串）。

---

## 三、配置 GitHub Secrets

打开仓库页面 → **Settings** → 左侧 **Secrets and variables** → **Actions** → **New repository secret**

依次添加这 4 个（名称必须完全一致）：

| Secret 名称 | 值 |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | 第二步生成的 base64 字符串 |
| `ANDROID_KEYSTORE_PASSWORD` | 第一步设的密钥库口令 |
| `ANDROID_KEY_ALIAS` | `jingshi`（或你自己设的别名） |
| `ANDROID_KEY_PASSWORD` | 密钥口令（若回车沿用，则与上面相同） |

⚠️ 注意：
- 名称**大小写敏感**，必须与上表完全一致
- 粘贴 base64 时**不要带多余空格或换行**
- 这些值一旦保存就**无法再查看**（只能重新设置），这是 GitHub 的有意设计

---

## 四、触发 release 构建

1. 打开仓库 **Actions** 标签
2. 左侧选 **Build Android APK**
3. 右侧点 **Run workflow**
4. 把 **「同时构建 release 包」** 勾上
5. 点绿色 **Run workflow**

构建完成后，在运行页面底部 **Artifacts** 区下载 `jingshi-ai-release-<commit>`。

---

## 五、安全性说明

| 项 | 说明 |
| --- | --- |
| base64 是加密吗？ | **不是。** base64 只是编码，任何人拿到都能还原出 keystore。它只用于「把二进制塞进文本字段」 |
| 那为什么安全？ | 因为 GitHub Secrets **加密存储、日志中自动打码、不可被 fork 的 PR 读取** |
| CI 里 keystore 会残留吗？ | **不会。** 我们把它写到临时目录，job 结束后整个虚拟机销毁 |
| 日志里会泄露密码吗？ | 不会。GitHub 会自动把 Secret 值在日志中替换为 `***` |

⚠️ **绝对不要**：
- 把 `release.keystore` 或 `keystore.properties` 提交到仓库（已在 `.gitignore` 中屏蔽）
- 在截图、聊天记录里暴露 keystore 内容或密码
- 把 base64 字符串贴到任何非 Secret 的地方

---

## 六、当前状态

| 项 | 状态 |
| --- | --- |
| Debug 构建流水线 | ✅ 已就绪，开箱可用 |
| Release 签名配置（build.gradle） | ✅ 已接入，读取 `keystore.properties` |
| Release Secrets | ⬜ 待你按上文配置 |
| keystore 文件 | ⬜ 待生成 |

配置完成后，release 构建即可一键出包。
