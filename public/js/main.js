window.addEventListener('load', function() {
    var ws = new ReconnectingWebSocket('wss://localhost:8080');

    ws.onopen = function(e) {
        console.log(e.data);
        setTimeout(function(){
            ws.send(JSON.stringify({type:'PING'}));
        },3000);
    }

    ws.onmessage = function(e) {
        message = JSON.parse(e.data);

        switch(message.type) {
            case 'PONG':
                console.log('PONG!');
                break;
            default:
        }
    }

    ws.onclose = function(e) {
        console.log('INFO: Closing: '+e.data);
    }
});
