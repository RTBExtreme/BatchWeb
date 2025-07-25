window.addEventListener('DOMContentLoaded', () => {
  let echoEnabled = true;
  let envVars = {
    PATH: "C:\\Windows\\System32;C:\\Windows",
    USERNAME: "BatchWeb",
    COMPUTERNAME: "BATCHWEB-PC"
  };
  const BatchWebConsole = document.createElement('div');
  BatchWebConsole.style.background = '#000';
  BatchWebConsole.style.color = '#fff';
  BatchWebConsole.style.padding = '10px';
  BatchWebConsole.style.fontFamily = 'Consolas, monospace';
  BatchWebConsole.style.height = '100vh';
  BatchWebConsole.style.overflowY = 'auto';
  BatchWebConsole.style.whiteSpace = 'pre-wrap';
  document.body.style.margin = '0';
  document.body.appendChild(BatchWebConsole);
  const inputLine = document.createElement('div');
  BatchWebConsole.appendChild(inputLine);
  let isWaitingTimeout = false;
  let timeoutResolve = null;
  let batchScriptLines = [];
  let labelsMap = {};
  let currentLineIndex = 0;
  let runningBatch = false;
  let commandRunning = false;
  let lastCommand = '';
  let cancelRequested = false;

  function print(text = '') {
    const line = document.createElement('div');
    line.textContent = text;
    line.style.color = BatchWebConsole.style.color;
    BatchWebConsole.insertBefore(line, inputLine);
    BatchWebConsole.scrollTop = BatchWebConsole.scrollHeight;
  }

  function addPrompt(prefill = '') {
    inputLine.innerHTML = '';
    const promptText = document.createElement('span');
    promptText.textContent = 'C:\\> ';
    promptText.style.color = BatchWebConsole.style.color;
    const input = document.createElement('input');
    input.type = 'text';
    input.style.background = 'black';
    input.style.color = BatchWebConsole.style.color;
    input.style.border = 'none';
    input.style.outline = 'none';
    input.style.font = 'inherit';
    input.style.width = '90%';
    input.value = prefill;
    inputLine.appendChild(promptText);
    inputLine.appendChild(input);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if(lastCommand) input.value = lastCommand;
        input.setSelectionRange(input.value.length, input.value.length);
        return;
      }
      if (isWaitingTimeout) {
        if (e.key === 'Enter') {
          if (timeoutResolve) {
            timeoutResolve();
            timeoutResolve = null;
          }
          e.preventDefault();
        } else if(e.key === 'c' && e.ctrlKey) {
          if (timeoutResolve) {
            cancelRequested = true;
            timeoutResolve();
            timeoutResolve = null;
          }
          e.preventDefault();
        } else {
          e.preventDefault();
        }
        return;
      }
      if (e.key === 'c' && e.ctrlKey) {
        if(commandRunning){
          cancelRequested = true;
          e.preventDefault();
        }
        return;
      }
      if (e.key === 'Enter') {
        if(commandRunning) return;
        commandRunning = true;
        cancelRequested = false;
        const commandText = input.value.trim();
        lastCommand = commandText;
        await executeCommand(commandText);
        commandRunning = false;
      }
    });
  }

  function expandVariables(str) {
    return str.replace(/%([^%]+)%/g, (_, v) => envVars[v.toUpperCase()] ?? '');
  }

  function hexDigitToColor(n) {
    const map = {
      '0': '#000000',
      '1': '#0000AA',
      '2': '#00AA00',
      '3': '#00AAAA',
      '4': '#AA0000',
      '5': '#AA00AA',
      '6': '#AAAA00',
      '7': '#AAAAAA',
      '8': '#555555',
      '9': '#FFFFFF',
    };
    return map[n] || null;
  }

  function applyColorCommand(arg) {
    if (!arg) return 'Usage: color [fg] or [bg][fg] where fg,bg are 0-9';
    if (arg.length === 1) {
      if (!/[0-9]/.test(arg)) return 'Invalid color code';
      const fgColor = hexDigitToColor(arg);
      if (!fgColor) return 'Invalid color code';
      BatchWebConsole.style.color = fgColor;
      return;
    }
    if (arg.length === 2) {
      const bg = arg[0];
      const fg = arg[1];
      if (!/[0-9]/.test(bg) || !/[0-9]/.test(fg)) return 'Invalid color codes';
      const fgColor = hexDigitToColor(fg);
      const bgColor = hexDigitToColor(bg);
      if (!fgColor || !bgColor) return 'Invalid color codes';
      BatchWebConsole.style.color = fgColor;
      BatchWebConsole.style.background = bgColor;
      return;
    }
    return 'Usage: color [fg] or [bg][fg]';
  }

  async function setPInput(varName, promptText) {
    isWaitingTimeout = true;
    inputLine.innerHTML = '';
    const promptSpan = document.createElement('span');
    promptSpan.textContent = promptText;
    promptSpan.style.color = BatchWebConsole.style.color;
    const input = document.createElement('input');
    input.type = 'text';
    input.style.background = 'black';
    input.style.color = BatchWebConsole.style.color;
    input.style.border = 'none';
    input.style.outline = 'none';
    input.style.font = 'inherit';
    input.style.width = '90%';
    inputLine.appendChild(promptSpan);
    inputLine.appendChild(input);
    input.focus();
    cancelRequested = false;
    return new Promise(resolve => {
      const onKey = e => {
        if (cancelRequested) {
          envVars[varName.toUpperCase()] = '';
          print('^C');
          isWaitingTimeout = false;
          inputLine.innerHTML = '';
          window.removeEventListener('keydown', onKey);
          resolve();
          if(!runningBatch) addPrompt();
          return;
        }
        if (e.key === 'Enter') {
          envVars[varName.toUpperCase()] = input.value;
          print(`${varName}=${input.value}`);
          isWaitingTimeout = false;
          inputLine.innerHTML = '';
          window.removeEventListener('keydown', onKey);
          resolve();
          if(!runningBatch) addPrompt();
        }
      };
      window.addEventListener('keydown', onKey);
    });
  }

  async function executeCommand(commandText) {
    if (cancelRequested) {
      print('^C');
      if (!runningBatch) addPrompt();
      return;
    }
    if (!commandText) {
      if (!runningBatch) addPrompt();
      return;
    }
    if (commandText.startsWith('::') || /^rem /i.test(commandText)) {
      if (!runningBatch) addPrompt();
      return;
    }
    let line = expandVariables(commandText);
    const lowCmd = line.toLowerCase();
    if (lowCmd === '@echo off') {
      echoEnabled = false;
      if (!runningBatch) addPrompt();
      return;
    } else if (lowCmd === '@echo on') {
      echoEnabled = true;
      if (!runningBatch) addPrompt();
      return;
    }
    if (echoEnabled && !runningBatch) print(`C:\\> ${commandText}`);
    if(cancelRequested){
      print('^C');
      if (!runningBatch) addPrompt();
      return;
    }
    const parts = line.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    if(parts.length === 0){
      if(!runningBatch) addPrompt();
      return;
    }
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).map(a => a.replace(/^"(.*)"$/, '$1'));

    if(cancelRequested){
      print('^C');
      if(!runningBatch) addPrompt();
      return;
    }

    if(cmd === 'goto'){
  const label = args[0];
  if(!label){
    print('goto command requires a label');
    if(!runningBatch) addPrompt();
    return;
  }
  const target = labelsMap[label.toLowerCase()];
  if(target === undefined){
    print(`Label not found: ${label}`);
    if(!runningBatch) addPrompt();
    return;
  }
  currentLineIndex = target;
  return;
}
    if(cmd === 'set' && args[0] === '/p'){
      const rest = line.match(/^set\s+\/p\s+([a-zA-Z_][a-zA-Z0-9_]*)=(.*)$/i);
      if(!rest){
        print('Usage: set /p VAR=PromptText');
        if(!runningBatch) addPrompt();
        return;
      }
      const varName = rest[1];
      const promptText = rest[2];
      await setPInput(varName, promptText);
      if(cancelRequested){
        print('^C');
        cancelRequested = false;
      }
      return;
    }
    if(cmd === 'pause'){
      print('Press any key to continue . . .');
      cancelRequested = false;
      await new Promise(res => {
        const onKey = e => {
          if(cancelRequested){
            print('^C');
            cancelRequested = false;
            window.removeEventListener('keydown', onKey);
            res();
            return;
          }
          window.removeEventListener('keydown', onKey);
          res();
        };
        window.addEventListener('keydown', onKey);
      });
      if(!runningBatch) addPrompt();
      return;
    }
    if(cmd === 'timeout'){
      const sec = Number(args[0]);
      if(isNaN(sec) || sec < 0){
        print('Usage: timeout [seconds]');
        if(!runningBatch) addPrompt();
        return;
      }
      print(`Waiting for ${sec} seconds... (Press Enter to skip, Ctrl+C to cancel)`);
      isWaitingTimeout = true;
      cancelRequested = false;
      await new Promise(res => {
        timeoutResolve = res;
        const timeoutId = setTimeout(() => {
          if(timeoutResolve){
            timeoutResolve();
            timeoutResolve = null;
          }
        }, sec * 1000);
        const onKey = e => {
          if(e.key === 'Enter'){
            if(timeoutResolve){
              clearTimeout(timeoutId);
              timeoutResolve();
              timeoutResolve = null;
            }
          }
          if(e.key === 'c' && e.ctrlKey){
            cancelRequested = true;
            if(timeoutResolve){
              clearTimeout(timeoutId);
              timeoutResolve();
              timeoutResolve = null;
            }
          }
        };
        window.addEventListener('keydown', onKey, { once: true });
      });
      isWaitingTimeout = false;
      if(cancelRequested){
        print('^C');
        cancelRequested = false;
      } else {
        print('Timeout ended.');
      }
      if(!runningBatch) addPrompt();
      return;
    }

    if(cancelRequested){
      print('^C');
      if(!runningBatch) addPrompt();
      return;
    }

    if(typeof window.commands[cmd] === 'function'){
      try {
        const res = await window.commands[cmd](...args);
        if(cancelRequested){
          print('^C');
          cancelRequested = false;
          if(!runningBatch) addPrompt();
          return;
        }
        if(res !== undefined && res !== '') print(String(res));
      } catch(e){
        print('Error: ' + e.message);
      }
    } else {
      print(`'${cmd}' is not recognized as an internal or external command.`);
    }
    if(!runningBatch) addPrompt();
  }

  async function runBatchScript(content) {
  batchScriptLines = content.split(/\r?\n/);
  labelsMap = {};
  for(let i = 0; i < batchScriptLines.length; i++){
    const line = batchScriptLines[i].trim();
    if(line.startsWith(':')){
      const label = line.slice(1).toLowerCase();
      labelsMap[label] = i + 1;
    }
  }
  runningBatch = true;
  currentLineIndex = 0;
  cancelRequested = false;

  while(currentLineIndex < batchScriptLines.length){
    if(cancelRequested){
      print('^C');
      cancelRequested = false;
      break;
    }
    let line = batchScriptLines[currentLineIndex].trim();
    if(!line || line.startsWith('::') || /^rem /i.test(line) || line.startsWith(':')){
      currentLineIndex++;
      continue;
    }
    const prevIndex = currentLineIndex;
    await executeCommand(line);

    // <-- Add 200ms cooldown delay here:
    await new Promise(r => setTimeout(r, 200));

    if(cancelRequested){
      print('^C');
      cancelRequested = false;
      break;
    }
    if(currentLineIndex === prevIndex){
      currentLineIndex++;
    }
  }
  runningBatch = false;
  addPrompt();
}
  window.commands = {
    help: () => `Supported commands:
echo [text]         - Display text
color [fg] or [bg][fg] - Set text and background color (0-9)
cls                 - Clear the screen
ver                 - Show version info
date                - Show current date
time                - Show current time
ping [host]         - Simulate ping command
whoami              - Show current user
set [VAR=VALUE]     - Set environment variable
set /p VAR=Prompt   - Prompt input and assign to VAR
set                  - List environment variables
exit                - Clear screen and end session
greet [name] [time] - Custom greet command
title [text]        - Set window/tab title
hostname            - Show computer name
tasklist            - Show running tasks (simulated)
systeminfo          - Show system info (simulated)
netstat             - Show network connections (simulated)
ipconfig            - Show IP config (simulated)
path                - Show PATH environment variable
pause               - Wait for key press
curl [url]          - Fetch URL and print text content
download [url]      - Download file from URL
js [code]           - Evaluate JS code
msg * [message]     - Popup message box
timeout [seconds]   - Wait for specified seconds (can press Enter to skip, Ctrl+C to cancel)
upload-bat          - Upload and run batch script file`,
    echo: (...args) => args.join(' '),
    cls: () => {
      BatchWebConsole.innerHTML = '';
      BatchWebConsole.appendChild(inputLine);
    },
    ver: () => `Microsoft Windows [Version 10.0.19045.2965]`,
    date: () => new Date().toLocaleDateString(),
    time: () => new Date().toLocaleTimeString(),
    ping: async (host) => {
      if(!host) return 'Ping usage: ping [host]';
      print(`Pinging ${host} with 32 bytes of data:`);
      for(let i=0;i<4;i++){
        if(cancelRequested) break;
        await new Promise(r=>setTimeout(r,500));
        if(cancelRequested) break;
        print(`Reply from ${host}: bytes=32 time=${Math.floor(Math.random()*100)}ms TTL=128`);
      }
      if(cancelRequested) return '^C';
      return `Ping statistics for ${host}:
    Packets: Sent = 4, Received = 4, Lost = 0 (0% loss),
Approximate round trip times in milli-seconds:
    Minimum = 0ms, Maximum = 100ms, Average = 50ms`;
    },
    whoami: () => envVars.USERNAME,
    set: (...args) => {
      if(args.length === 0){
        let allVars = [];
        for(const k in envVars){
          allVars.push(`${k}=${envVars[k]}`);
        }
        return allVars.join('\n');
      }
      const assign = args.join(' ').split('=');
      if(assign.length !== 2) return 'Usage: set VAR=VALUE';
      const key = assign[0].toUpperCase();
      const val = assign[1];
      envVars[key] = val;
    },
    exit: () => {
      BatchWebConsole.innerHTML = '';
      BatchWebConsole.appendChild(inputLine);
    },
    greet: (name = 'user', time = 'day') => `Good ${time}, ${name}!`,
    title: (text = '') => {
      document.title = text;
    },
    hostname: () => envVars.COMPUTERNAME,
    tasklist: () => `Image Name                     PID Session Name        Session#    Mem Usage
System Idle Process              0 Services                   0         24 K
System                           4 Services                   0        224 K
smss.exe                       388 Services                   0        492 K
explorer.exe                  2284 Console                    1      15,280 K
cmd.exe                      4520 Console                    1       1,020 K
`,
    systeminfo: () => `Host Name: ${envVars.COMPUTERNAME}
OS Name: Microsoft Windows 10 Pro
OS Version: 10.0.19045 Build 19045
System Manufacturer: Generic
System Model: Emulator PC
Processor(s): 1 Processor(s) Installed.
Total Physical Memory: 8 GB`,
    netstat: () => `Active Connections

  Proto  Local Address          Foreign Address        State
  TCP    127.0.0.1:80           0.0.0.0:0              LISTENING
  TCP    192.168.0.101:139      0.0.0.0:0              LISTENING`,
    ipconfig: () => `Windows IP Configuration

Ethernet adapter Ethernet:

   Connection-specific DNS Suffix  . : localdomain
   IPv4 Address. . . . . . . . . . . : 192.168.0.101
   Subnet Mask . . . . . . . . . . . : 255.255.255.0
   Default Gateway . . . . . . . . . : 192.168.0.1`,
    path: () => envVars.PATH,
    curl: async (url) => {
      if(!url) return 'Usage: curl [url]';
      try {
        let response = await fetch(url);
        let text = await response.text();
        return text.slice(0, 2000);
      } catch {
        return 'Error: Failed to fetch URL';
      }
    },
    download: async (url) => {
      if(!url) return 'Usage: download [url]';
      try {
        let response = await fetch(url);
        if(!response.ok) return 'Download failed';
        let blob = await response.blob();
        let a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        let urlParts = url.split('/');
        a.download = urlParts[urlParts.length-1] || 'download';
        a.click();
        return `Downloaded ${a.download}`;
      } catch {
        return 'Error: Download failed';
      }
    },
    js: (code) => {
      try {
        let result = eval(code);
        return result === undefined ? '' : String(result);
      } catch(e) {
        return 'JS Error: ' + e.message;
      }
    },
    msg: (...args) => {
      const m = args.slice(1).join(' ');
      alert(m);
    },
    'upload-bat': () => {
      const inputFile = document.createElement('input');
      inputFile.type = 'file';
      inputFile.accept = '.bat,.cmd';
      inputFile.onchange = () => {
        const file = inputFile.files[0];
        if(!file) return;
        const reader = new FileReader();
        reader.onload = e => {
          runBatchScript(e.target.result);
        };
        reader.readAsText(file);
      };
      inputFile.click();
    }
  };
  print(`Microsoft Windows [Version 10.0.19045.2965]`);
  print(`Running under BatchWeb Enviroment (v1.0)`);
  addPrompt();
});
