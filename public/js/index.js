var ws;

function sendInvite(receiver) {
    ws.send(JSON.stringify({
        type: 'INVITE',
        receiver: receiver
    }));
}

function watchBoard(boardId) {
    window.location.href = '/play?board='+boardId;
}

function acceptInvite(sender) {
    ws.send(JSON.stringify({
        type: 'ACCEPT',
        sender: sender
    }));
}

window.addEventListener('load', function () {
    ws = new ReconnectingWebSocket('wss://' + document.domain + ':8080');

    ws.onopen = function (e) {
        console.log(e.data);
        setTimeout(function () {
            ws.send(JSON.stringify({ type: 'PING' }));
        }, 3000);
    }

    ws.onmessage = function (e) {
        message = JSON.parse(e.data);
        console.log('MEssage received:');
        console.log(message);
        switch (message.type) {
            // Player environment messages
            case 'ONLINE_LIST':
                refreshOnlineList(message.data);
                break;

            case 'INVITE':
                refreshInviteList(message.data);
                break;

            case 'BOARD_LIST':
                refreshBoardList(message.data);
                break;

            case 'BOARD_READY':
                let redirectUrl = '/play?board='+message.data.id;
                if(message.data.w === document.cookie.replace(/(?:(?:^|.*;\s*)username\s*\=\s*([^;]*).*$)|^.*$/, "$1"))
                    message.data.w = 'you';
                else
                    message.data.b = 'you';

                if(window.confirm('Board '+message.data.id+' ready.\nWhite: '+
                        message.data.w+'\nBlack: '+message.data.b+'\n\nPlay?'))
                    window.location.href = redirectUrl;
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

    function refreshOnlineList(onlineList) {
        console.log(onlineList);
        let username = document.cookie.replace(/(?:(?:^|.*;\s*)username\s*\=\s*([^;]*).*$)|^.*$/, "$1");
        console.log(username);
        if (username != '')
            onlineList.splice(onlineList.indexOf(username), 1);
        console.log(onlineList);
        let render = '';
        onlineList.forEach(player => {
            render += '<div class="card">\
<div class="card-header" id="h_'+ player + '" onclick="$(\'#collapse_' + player + '\').collapse(\'toggle\')">\
<h5 class="mb-0">\
<button class="btn btn-link collapsed" type="button" data-toggle="collapse" data-target="#collapseTwo" aria-expanded="false" aria-controls="collapseTwo">\
'+ player + '\
</button></h5></div>\
<div id="collapse_'+ player + '" class="collapse" aria-labelledby="headingTwo" data-parent="#accordionExample" style="">\
<div class="card-body">\
<button type="button" class="btn btn-light" onClick="sendInvite(\''+ player + '\')">Invite</button>\
</div></div></div>'
        });

        document.getElementById('onlineList').innerHTML = render;
    }

    function refreshBoardList(boardList) {
        let render = '';
        boardList.forEach(board => {
            render += '<div class="card">\
<div class="card-header" id="h_'+board.boardId+'" onclick="$(\'#collapse_'+board.boardId+'\').collapse(\'toggle\')">\
<h5 class="mb-0">\
<button class="btn btn-link collapsed" type="button" data-toggle="collapse" data-target="#collapseTwo" aria-expanded="false" aria-controls="collapseTwo">\
White:'+board.w+' X Black: '+board.b+'\
</button></h5></div>\
<div id="collapse_'+board.boardId+'" class="collapse" aria-labelledby="headingTwo" data-parent="#accordionExample" style="">\
<div class="card-body">\
<button type="button" class="btn btn-light" onClick="watchBoard(\''+board.boardId+'\')">Watch</button>\
</div></div></div>'
        });
        document.getElementById('boardList').innerHTML = render;
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