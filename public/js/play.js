var ws;

function acceptInvite(sender) {
    ws.send(JSON.stringify({
        type: 'ACCEPT',
        sender: sender
    }));
}

window.addEventListener('load', function () {
    ws = new ReconnectingWebSocket('wss://' + document.domain + ':8080/play');

    ws.onopen = function (e) {
        console.log(e.data);
        setTimeout(function () {
            ws.send(JSON.stringify({ type: 'PING' }));
        }, 3000);
        $('#movebtn').click(() => {
            ws.send(JSON.stringify({
                type: 'MOVE',
                move: {
                    from: $('#move').val().split(' ')[0],
                    to: $('#move').val().split(' ')[1]
                }
            }))
        });
    }

    ws.onmessage = function (e) {
        message = JSON.parse(e.data);
        console.log('MEssage received:');
        console.log(message);
        switch (message.type) {
            // Player environment messages
            case 'INVITE':
                console.log('Invite received: ');
                console.log(message.data);
                refreshInviteList(message.data);
                break;

            case 'NEW_TABLE':
                let newTable = message.data;
                console.log('Novo tabuleiro recebido');
                console.log(newTable);
                if(newTable.w === document.cookie.replace(/(?:(?:^|.*;\s*)username\s*\=\s*([^;]*).*$)|^.*$/, "$1"))
                    newTable.w = 'you';
                else
                    newTable.b = 'you';

                if(window.confirm('Table ready.\nWhite: '+newTable.w+
                        '\nBlack: '+newTable.b+'.\n\nPlay?'))
                    window.location.href = '/play?table='+newTable.id;
                break;

            // Game messages
            case 'REFRESH_TABLE':
                $('#table').html('<pre>'+message.data.ascii+'</pre>');
                $('#info').text('Its '+(message.data.fen.split(' ')[1] === 'w' ?
                    'white' : 'black')+'\'s turn!');
                break;
            case 'INVALID_MOVE':
                $('#info').text('Invalid move!');
                break;
            case 'TABLE_CLOSE':
                $('#info').text('Table close! Reason: '+message.data);
                break;

            // Debug 
            case 'PONG':
                console.log('PONG!');
                break;
            default:
                console.log('Unrecognized message:');
                console.log(message);
        }
    }

    ws.onclose = function (e) {
        console.log('INFO: Closing: ' + e.data);
    }

    function refreshInviteList(inviteList) {
        let render = '';
        inviteList.forEach(sender => {
            render += '<button class="dropdown-item" type="button"\
            onClick="acceptInvite(\''+ sender + '\')">' + sender + '</button>'
        });
        document.getElementById('inviteList').innerHTML = render;
    }
});