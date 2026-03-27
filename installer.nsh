!macro customHeader
  !system "echo 'Custom NSIS Header'"
!macroend

!macro customInstall
  ; 添加开机自启选项
  MessageBox MB_YESNO "是否设置开机自动启动？" IDYES setAutoStart IDNO skipAutoStart
  setAutoStart:
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "OpenCode Bridge" "$INSTDIR\OpenCode Bridge.exe"
  skipAutoStart:
!macroend

!macro customUnInstall
  ; 删除开机自启项
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "OpenCode Bridge"

  ; 提示用户是否删除数据目录
  MessageBox MB_YESNO "是否删除应用数据目录？$\n$\n数据目录位置：$APPDATA\opencode-bridge$\n$\n选择「是」将删除所有配置和会话数据，选择「否」将保留数据以便下次安装使用。" IDYES deleteData IDNO keepData
  deleteData:
    RMDir /r "$APPDATA\opencode-bridge"
  keepData:
!macroend