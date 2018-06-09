#! /usr/bin/node

const fs = require('fs');
const ws = require('ws');
const http = require('http');
const https = require('https');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const Chess = require('chess.js').Chess;

var mongo = require('mongodb').MongoClient;
var PubSub = require('pubsub-js');

/// Session parser definition
////////////////////////////////////////////////////////////////////////////////
var sessionParser = session({secret: 'Hu3Hu3BR'});

/// WebServer definition
////////////////////////////////////////////////////////////////////////////////
// The WebServer will handle request events and authenticate the clients
var app = express();

app.use(sessionParser);
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));

const options = { root: __dirname+'/public/' };

app.get('/',function(req,res){
    if(req.session.username) {
        res.sendFile('lobby.html',options);
    }
    else {
        res.sendFile('index.html',options);
    }
});

app.get('/login', function(req,res){
    if(req.session.username) {
        res.redirect('/');
    }
    else {
        res.sendFile('login.html',options);
    }
});

app.post('/login',async function(req,res){
    if(req.body['password-confirm']){
        if(req.body.password === req.body['password-confirm']) {
            if(await db.createUser(req.body.username, req.body.password)) {
                req.session.username = req.body.username;
                console.log('APP: Signing up '+req.session.username);
                res.cookie('username',req.session.username,{httpOnly:false});
                res.redirect('/');
            }
            else
                res.redirect('/login?status=userExists');
        }
        else
            res.redirect('/login?status=passNotEqual');
    }
    else {
        if(await db.validateUser(req.body.username, req.body.password)) {
            req.session.username = req.body.username;
            console.log('APP: Logging in '+req.session.username);
            res.cookie('username',req.session.username,{httpOnly:false});
            res.redirect('/');
        }
        else
            res.redirect('/login?status=credNotMatch');
    }
});

app.get('/play',function(req,res){
    if(req.session.username) {
        req.session.board = req.query.board;
        res.sendFile('play.html',options);
    }
    else {
        res.redirect('/login');
    }
});

app.get('/profile',function(req,res){
    if(req.session.username) {
        res.cookie('username',req.session.username,{httpOnly:false});
        res.sendFile('profile.html',options);
    } else {
        res.redirect('/login');
    }
});

app.get('/logout',function(req,res){
    req.session.destroy(function(err) {
        if(err) {
            console.log(err);
        } else {
            res.redirect('/');
        }
    });
});

app.use(express.static(__dirname + '/public'));

app.use(function(req, res) {
    res.status(404).send('Sorry, can\'t find that!');
});

/// HTTP server definition
////////////////////////////////////////////////////////////////////////////////
// The HTTP server will receive HTTP requests and forward it to the WebServer or
// to the WebSockts server. Create your own tls cert with the instructions found
// at ./tls
var server = https.createServer({
    passphrase: 'Hu3Hu3BR',
    key: fs.readFileSync(__dirname+'/tls/key.pem'),
    cert: fs.readFileSync(__dirname+'/tls/cert.pem')
},app);

/// WebSocket server definition
////////////////////////////////////////////////////////////////////////////////
// The WebSocket server will handle 'upgrade' events from HTTP server,
// exchanging asynchronous messages between authenticated users and the server,
// like invitations, game status broadcast and chess movements
var wss = new ws.Server({
    server: server,
    verifyClient: function (info,done) {
        console.log('WSS: Going to verify client now...');
        sessionParser(info.req,{},function() {
            console.log('WSS: Verifying client: '+info.req.session.username);
            done(info.req.session.username);
        });
    }
});

wss.on('connection', function connection(ws,req) {
    // Associate the websocket with a session-logged user
    ws.username = req.session.username;
    // Save request information to retrieve the user session later, 
    // since sessions may be stored outside the memory
    ws.req = {
        headers: { cookie: req.headers.cookie},
        url: req.url,
        _parsedUrl: req._parsedUrl
    };
    // If it is a ws open from the play page, then is must be linked to a board
    if(req._parsedUrl.pathname === '/play') {
        ws.board = req.session.board;
        var tokenGAME_MSGS = PubSub.subscribe(ws.board,(msg,data) => {
            ws.send(JSON.stringify({
                type: msg.split('.')[1],
                data: data
            }));
        });
    }
    // Procedures to make components forget the websocket when he die
    ws.forget = function() {
        PubSub.unsubscribe(tokenPLAYER_MSGS);
        PubSub.unsubscribe(tokenONLINE_LIST);
        PubSub.unsubscribe(tokenBOARD_LIST);
        PubSub.unsubscribe(tokenGAME_MSGS);
        PubSub.publish(ws.board?'WS_CLOSE.PLAY':'WS_CLOSE', ws);
    }
    // Returns false and forget ws of state is not OPEN, or true otherwise
    ws.isOpen = function() {
        if(ws.readyState === ws.OPEN)
            return true;
        console.log('WARN: WSS: WebSocket closed wrong');
        console.log(ws);
        ws.forget();
        return false;
    }

    // Subscribe websocket to receive messages to the player
    var tokenPLAYER_MSGS = PubSub.subscribe(ws.username, (msg,data) => {
        if(!ws.isOpen()) return;

        switch(msg.split('.')[1]) {
            case 'ONLINE_LIST':
                ws.send(JSON.stringify({
                    type: 'ONLINE_LIST',
                    data: data
                }));
                break;
            case 'BOARD_LIST':
                ws.send(JSON.stringify({
                    type: 'BOARD_LIST',
                    data:data
                }));
            case 'INVITE':
                ws.send(JSON.stringify({
                    type: 'INVITE',
                    data: data
                }));
                break;
            case 'BOARD_READY':
                ws.send(JSON.stringify({
                    type: 'BOARD_READY',
                    data: data
                }));
                break;
            case 'LOAD_BOARD':
                ws.send(JSON.stringify({
                    type: 'LOAD_BOARD',
                    data:data
                }));
                break;
            case 'INVALID_MOVE':
                ws.send(JSON.stringify({
                    type:'INVALID_MOVE',
                    data:data
                }))
                break;
            default:
                console.log('WARN: WSS: Unespected internal message received:');
                console.log(msg);
        }
    });

    // Subscribe websocket to receive updates from the list of online players
    var tokenONLINE_LIST = PubSub.subscribe('ONLINE_LIST', (msg,data) => {
        if(!ws.isOpen()) return;
        
        ws.send(JSON.stringify({
            type: 'ONLINE_LIST',
            data: data
        }));
    });

    // Subscribe websocket to receive updates from the list of active boards
    var tokenBOARD_LIST = PubSub.subscribe('BOARD_LIST', (msg,data) => {
        if(!ws.isOpen()) return;
        
        ws.send(JSON.stringify({
            type: 'BOARD_LIST',
            data: data
        }));
    });

    // Tells the player environment controller that a new ws is open
    PubSub.publish('WS_CONNECTION',ws);

    ws.on('message', function incoming(message) {
        m = JSON.parse(message);
        switch(m.type) {
            // Player environment messages
            case 'INVITE':
                PubSub.publish('INVITE',{sender:ws.username,receiver:m.receiver});
                break;
            case 'ACCEPT':
                PubSub.publish('ACCEPT',{sender:m.sender,receiver:ws.username});
                break;
            case 'REJECT':
                PubSub.publish('REJECT',m.inviteId);
                break;
            // Game messages
            case 'MOVE':
                PubSub.publish('MOVE',Object.assign(m.move,{
                    player:ws.username,
                    board:ws.board
                }));
                break;
            // Debug messages
            case 'PING':
                console.log('INFO: '+ws.username+' sent a PING');
                ws.send(JSON.stringify({type:'PONG'}));
                break;
            default:
                console.log('WARN: WSS: Unespected external message received:');
                console.log(m);
        }
    });

    ws.on('close', function() {
        ws.forget();
    });
});

/// Player environment controller definition
////////////////////////////////////////////////////////////////////////////////
// The player controller will handle general actions comming from the users that
// are logged in, manage invitation, create new instances of the game and handle
// any other kind of interaction between players
var pec = new (function PeC() {
    this.online = {};   // Store websockets open by online users
    this.invites = {};  // Store a list of invitations

    // Returns an array with the username of online users
    PeC.prototype.listOnlineUsernames = function() {
        return Object.keys(this.online);
    }

    PubSub.subscribe('WS_CONNECTION', (msg,ws) => {
        if(this.online[ws.username]) {
            this.online[ws.username].push(ws);
            PubSub.publish(ws.username+'.ONLINE_LIST',Object.keys(this.online));
        }
        else {
            this.online[ws.username] = [ws];
            PubSub.publish('ONLINE_LIST',Object.keys(this.online));
        }
    });

    PubSub.subscribe('WS_CLOSE', (msg,ws) => {
        if(!this.online[ws.username] || 
            (index = this.online[ws.username].indexOf(ws)) === -1)
            return;

        this.online[ws.username].splice(index,1);
        if(this.online[ws.username].length === 0) {
            setTimeout(() => {
                if(this.online[ws.username].length === 0) {
                    delete this.online[ws.username];
                    PubSub.publish('ONLINE_LIST',Object.keys(this.online));
                }
            },1000);
        }
    });

    PubSub.subscribe('INVITE', (msg, invite) => {
        if(!this.invites[invite.receiver])
            this.invites[invite.receiver] = {
                [invite.sender]:((new Date()).getTime() + 60000)};
        else
            this.invites[invite.receiver][invite.sender] = 
                                 (new Date()).getTime() + 60000;

        PubSub.publish(invite.receiver+'.INVITE',
            Object.keys(this.invites[invite.receiver]));
    });

    PubSub.subscribe('ACCEPT', (msg, invite) => {
        if(this.invites[invite.receiver][invite.sender])
            PubSub.publish('NEW_GAME',invite);
    });

    PubSub.subscribe('REJECT', (msg, inviteId) => {
        // Not implemented
    });

    // Remove expired invitations
    setInterval(() => {
        Object.keys(this.invites).forEach(receiver => {
            Object.keys(this.invites[receiver]).forEach(sender => {
                if(this.invites[receiver][sender] < (new Date()).getTime())
                    delete this.invites[receiver][sender];
            });
            if(Object.keys(this.invites[receiver]).length === 0){
                delete this.invites[receiver];
                PubSub.publish(receiver+'.INVITE',[]);
            }
            else
                PubSub.publish(receiver+'.INVITE',
                    Object.keys(this.invites[receiver]));
        });
    },30000);
})();

/// Functions declaration
////////////////////////////////////////////////////////////////////////////////
// Functions that will perform some tasks, when called above
var IDmaker = function ID(prefix = '') {
    this.idMaker = function*() {
        var index = 0;
        while(true) yield index++;
    }();
    ID.prototype.next = () => { 
        return prefix+this.idMaker.next().value;
    };
}

/// Game controller definition
////////////////////////////////////////////////////////////////////////////////
// The game controller will create, handle and destroy all the game instances,
// exchange messages with Websocket server, and save/retrieve game data to the
// implemented storage service
var chessctl = new (function ChessCtl() {
    this.boards = {}; // Store boards been used
    this.idMaker = new IDmaker('brd_');

    ChessCtl.prototype.getBoardList = function() {
        var list = [];
        Object.keys(this.boards).forEach(boardId => {
            list.push({
                boardId: boardId,
                w:this.boards[boardId].players.w,
                b:this.boards[boardId].players.b
            });
        });
        return list;
    };

    PubSub.subscribe('NEW_GAME', (msg,data) => {
        var newBoardMeta = {
            id: this.idMaker.next(),
            w: data.sender,
            b: data.receiver
        };
        var newBoard = new Chess();
        newBoard.players = {w:data.sender,b:data.receiver};
        this.boards[newBoardMeta.id] = newBoard;

        PubSub.publish(data.sender+'.BOARD_READY',newBoardMeta);
        PubSub.publish(data.receiver+'.BOARD_READY',newBoardMeta);
        PubSub.publish('BOARD_LIST',this.getBoardList());
    });

    PubSub.subscribe('MOVE', (msg, data) => {
        console.log('ChessCtl: Move received: ', data);
        let board = this.boards[data.board];
        if(board && data.player === board.players[board.turn()]) {
            let move = board.move(data);
            if(move)
                PubSub.publish(data.board+'.REFRESH_BOARD', {
                    move: move,
                    fen: board.fen(),
                    ascii: board.ascii()
                });
            else
                PubSub.publish(data.player+'.INVALID_MOVE',{fen:board.fen()});
        }
    });

    PubSub.subscribe('WS_CONNECTION', (msg,data) => {
        let board = this.boards[data.board];
        if(board) {
            PubSub.publish(data.username+'.LOAD_BOARD',{
                fen:board.fen(),
                ascii:board.ascii(),
                players: board.players
            });
            if(board.players.w === data.username && board.wTimeout)
                clearTimeout(board.wTimeout);
            else if(board.players.b === data.username && board.bTimeout)
                clearTimeout(board.bTimeout);
        }
        else
            PubSub.publish(data.username+'.BOARD_LIST',this.getBoardList());
    });

    PubSub.subscribe('WS_CLOSE.PLAY', (msg,data) => {
        if(board = this.boards[data.board])
            if(board.players.w == data.username)
                board.wTimeout = setTimeout(() => {
                    PubSub.publish(data.board+'.BOARD_CLOSE', 'Player give up');
                    delete board;
                    delete this.boards[data.board];
                    PubSub.publish('BOARD_LIST',this.getBoardList());
                }, 1000);
            else if(board.players.b == data.username)
                board.bTimeout = setTimeout(() => {
                    PubSub.publish(data.board+'.BOARD_CLOSE', 'Player give up');
                    delete board;
                    delete this.boards[data.board];
                    PubSub.publish('BOARD_LIST',this.getBoardList());
                }, 1000);
    });
})();

/// Database controller definition
////////////////////////////////////////////////////////////////////////////////
// The db controller will perform queries on the db server. Here is in use the
// MongoDB server.
var db = (function DataBaseCtl() {
    const url = 'mongodb://localhost:27017/chessure';

    return {
        usernameAvailable: function(username) {
            return new Promise(resolve => {
                mongo.connect(url, function(err, cli) {
                    if (err) throw err;
                    var db = cli.db();
                    db.collection('users').find({username}).toArray((err,result)=> {
                        cli.close();
                        if (err) throw err;
                        if (result[0])
                            resolve(false);
                        else
                            resolve(true);
                    });
                });
            });
        },
        createUser: function(username, passhash) {
            return new Promise(resolve => {
                mongo.connect(url, function(err, cli) {
                    if (err) throw err;
                    var db = cli.db();
                    db.collection('users').find({username}).toArray((err,result)=> {
                        if (err) throw err;
                        if (result[0]) {
                            resolve(false);
                            return;
                        }
                    });
                    db.collection('users').insertOne({username,passhash},
                            function(err, res) {
                        cli.close();
                        if (err) throw err;
                        else resolve(true);
                    });
                });
            });
        },
        validateUser: function(username, passhash) {
            return new Promise(resolve => {
                mongo.connect(url, function(err, cli) {
                    if (err) throw err;
                    var db = cli.db();
                    db.collection('users').find({username}).toArray((err,result)=> {
                        cli.close();
                        if (err) throw err;
                        else if(result[0] && result[0].passhash === passhash) {
                            console.log(result[0].passhash, passhash);
                            resolve(true);
                        }
                        else resolve(false);
                    });
                });
            });
        }
    }
})();

/// HTTP servers start up
////////////////////////////////////////////////////////////////////////////////
server.listen(8080, function() {
    console.log('Server https started on port '+server.address().port);
});

http.createServer(function(req,res){
    res.writeHead(302,  {Location: "https://"+req.headers.host.split(':')[0]+":8080"});
    res.end();
}).listen(3000,function() {
    console.log('Server http started on port 3000');
});
