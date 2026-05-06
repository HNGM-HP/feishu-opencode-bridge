!macro customHeader
  !system "echo 'Custom NSIS Header'"
!macroend

!macro customInstall
  ; 安装阶段不再弹任何选择框：
  ; - 开机自启的开关已迁移到 Web → 系统设置 → Bridge 服务，运行时按需切换；
  ; - 静默安装能避免「Windows 安装卡半程很久」时多一次用户交互。
!macroend

!macro customUnInstall
  ; 卸载时仅清理可能残留的开机自启注册表项，
  ; 不再询问是否删除 $APPDATA\opencode-bridge：保留配置/会话数据以便重装时恢复。
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "OpenCode Bridge"
!macroend
