# Windows ALLOWED_DIRECTORIES 配置指南

## 路径格式示例

### 1. 绝对路径（推荐使用正斜杠）

```json
{
  "ALLOWED_DIRECTORIES": [
    "C:/Users/YourName/Projects",
    "D:/Development",
    "E:/Work/Code"
  ]
}
```

### 2. 使用反斜杠（需要双写）

```json
{
  "ALLOWED_DIRECTORIES": [
    "C:\\Users\\YourName\\Projects",
    "D:\\Development",
    "E:\\Work\\Code"
  ]
}
```

### 3. 相对路径

```json
{
  "ALLOWED_DIRECTORIES": [
    ".",
    "./projects",
    "./workspace"
  ]
}
```

### 4. 环境变量

```json
{
  "ALLOWED_DIRECTORIES": [
    "%USERPROFILE%/Projects",
    "%USERPROFILE%\\Documents",
    "C:/Users/%USERNAME%/Desktop"
  ]
}
```

## 配置文件位置

Windows 系统下的配置文件位置：
- 用户设置：`C:\Users\YourName\.claude\settings.json`
- 本地设置：`C:\Users\YourName\.claude\settings.local.json`

## 注意事项

- 推荐使用正斜杠 `/` 避免转义问题
- 路径不要以分隔符结尾（如 `C:/Projects/`）
- 确保目录存在且有访问权限
- 支持中文目录名和网络路径（UNC）
