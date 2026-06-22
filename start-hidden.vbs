' 업무일지 서버를 콘솔 창 없이(숨김) 시작하는 런처.
' 작업 스케줄러가 로그온 시 이 스크립트를 실행한다.
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = dir
' 0 = 창 숨김, False = 종료 대기 안 함. 출력은 server.log 로 남긴다.
sh.Run "cmd /c node --use-system-ca server.js > server.log 2>&1", 0, False
