@echo off
REM Effi Reactor Analysis - one-click updater for Windows.
REM Double-click this file. It runs update.sh via the Git Bash that
REM was installed alongside Git.

setlocal
set "HERE=%~dp0"

for %%B in (
  "%ProgramFiles%\Git\bin\bash.exe"
  "%ProgramFiles(x86)%\Git\bin\bash.exe"
  "%LOCALAPPDATA%\Programs\Git\bin\bash.exe"
) do (
  if exist %%B (
    %%B "%HERE%update.sh" %*
    exit /b %errorlevel%
  )
)

echo.
echo ERROR: Could not find Git Bash.
echo Git should have installed it at "C:\Program Files\Git\bin\bash.exe".
echo Reinstall Git from https://git-scm.com/download/win and try again.
echo.
pause
