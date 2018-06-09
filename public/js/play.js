var chessure = (() => {
    var ws;

    window.addEventListener('load',() => {
        ws = new ReconnectingWebSocket('wss://'+document.domain+':8080/play');
        chessure.username = document.cookie.replace(
            /(?:(?:^|.*;\s*)username\s*\=\s*([^;]*).*$)|^.*$/, "$1");

        $('#dropdownMenu2').text(chessure.username);

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
                case 'INVITE':
                    refreshInviteList(message.data);
                    break;

                case 'BOARD_READY':
                    let redirectUrl = '/play?board='+message.data.id;
                    if(message.data.w === chessure.username)
                        message.data.w = 'you';
                    else
                        message.data.b = 'you';
    
                    if(window.confirm('Board '+message.data.id+' ready.\nWhite: '+
                            message.data.w+'\nBlack: '+message.data.b+'\n\nPlay?'))
                        window.location.href = redirectUrl;
                    break;

                // Game messages
                case 'LOAD_BOARD':
                    $('#possibleChat').html('<pre>'+message.data.ascii+'</pre>');
                    game.loadBoard(message.data.fen,message.data.players);
                    break;
                case 'REFRESH_BOARD':
                    $('#possibleChat').html('<pre>'+message.data.ascii+'</pre>');
                    game.refreshBoard(message.data.move, message.data.fen);
                    break;
                case 'INVALID_MOVE':
                    $('#info').text('Invalid move!');
                    game.refreshBoard(null, message.data.fen);
                    break;
                case 'BOARD_CLOSE':
                    $('#info').text('Board close! Reason: '+message.data);
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
    });

    function refreshInviteList(inviteList) {
        let render = '';
        inviteList.forEach(sender => {
            render += '<button class="dropdown-item" type="button"'+
        'onClick="chessure.acceptInvite(\''+ sender + '\')">'+sender+'</button>'
        });
        document.getElementById('inviteList').innerHTML = render;
    }

    return {
        username: '',

        acceptInvite: function(sender) {
            ws.send(JSON.stringify({type: 'ACCEPT', sender}));
        },

        sendMove: function(move) {
            ws.send(JSON.stringify({type: 'MOVE', move}));
        }
    };
})();

var game = (() => {
    var board, turn = 'white';

    let boardMethods = {
        onDrop: (oldPos, newPos) => {
            chessure.sendMove({from: oldPos, to: newPos});
        },

        onDragStart: (source, piece, position, orientation) => {
            if (orientation !== turn || 
                (turn === 'white' && piece.search(/^w/) === -1) ||
                (turn === 'black' && piece.search(/^b/) === -1))
                return false;
        }
    }

    return {
        loadBoard: function(fen,players) {
            let playerColor = players.w === chessure.username ? 'white' : 
                players.b === chessure.username ? 'black' : undefined;

            if(playerColor) {
                board = Chessboard('#board', Object.assign(boardMethods, {
                    draggable: true,
                    position: fen,
                    orientation: playerColor}));
            }
            else
                board = Chessboard('#board',{position: fen});

            turn = (fen.split(' ')[1] === 'w') ? 'white' : 'black';
            $('#info').text('Its '+turn+'\'s turn!');
        },

        refreshBoard: function(move, fen) {
            board.position(fen);
            if(move) {
                turn = (move.color === 'b') ? 'white' : 'black';
                $('#info').text('Its '+turn+'\'s turn!');
            }
        }
    }
})();