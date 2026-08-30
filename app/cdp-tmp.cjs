const WebSocket = require('ws');
const http = require('http');
const expr = process.argv[2];
http.get('http://localhost:9333/json/list', r => {
  let b=''; r.on('data',c=>b+=c); r.on('end',()=>{
    const ws = new WebSocket(JSON.parse(b)[0].webSocketDebuggerUrl, {perMessageDeflate:false});
    ws.on('open', ()=> ws.send(JSON.stringify({id:1, method:'Runtime.evaluate',
      params:{expression:expr, awaitPromise:true, returnByValue:true}})));
    ws.on('message', m => {
      const d = JSON.parse(m);
      if (d.id===1){ console.log(JSON.stringify(d.result?.result?.value ?? d.result, null, 1).slice(0,4000)); ws.close(); }
    });
  });
});
