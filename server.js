#! /usr/bin/node

const fs = require('fs');
const ws = require('ws');
const http = require('http');
const https = require('https');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const Chess = require('chess.js').Chess;

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
        res.sendFile('index.html',options);
    }
    else {
        res.redirect('/login');
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

app.post('/login',function(req,res){
    req.session.username = req.body.username;
    console.log('Logging in '+req.session.username);
    res.cookie('username',req.session.username,{httpOnly:false});
    res.redirect('/');
});

app.get('/play',function(req,res){
    if(req.session.username) {
        res.sendFile('play.html',options);
    }
    else {
        res.redirect('/login');
    }
});

app.get('/profile',function(req,res){
    if(req.session.username) {
        res.write('<h1>Hello '+req.session.username+'</h1>');
        res.end('<a href="/logout">Logout</a>');
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

/// HTTP server definition
////////////////////////////////////////////////////////////////////////////////
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
        sessionParser(info.req,{},function() {
            //console.log('Verifying client: '+info.req.session.username);
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
    // Procedures to make components forget the websocket when he die
    ws.forget = function() {
        PubSub.unsubscribe(tokenPLAYER_MSGS);
        PubSub.unsubscribe(tokenONLINE_LIST);
        PubSub.unsubscribe(tokenTABLE_LIST);
        PubSub.publish('WS_CLOSE', ws);
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

    // Tells the player environment controller that a new ws is open
    PubSub.publish('WS_CONNECTION',ws);

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
            case 'INVITE':
                console.log('WSS: refreshing invites of '+ws.username);
                ws.send(JSON.stringify({
                    type: 'INVITE',
                    data: data
                }));
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

    // Subscribe websocket to receive updates from the list of active tables
    var tokenTABLE_LIST = PubSub.subscribe('TABLE_LIST', (msg,data) => {
        if(!ws.isOpen()) return;
        
        ws.send(JSON.stringify({
            type: 'TABLE_LIST',
            data: data
        }));
    });

    ws.on('message', function incoming(message) {
        m = JSON.parse(message);
        switch(m.type) {
            // Player environment messages
            case 'INVITE':
                console.log('INFO: WSS says:');
                console.log('      '+ws.username+'sent an invite to '+m.receiver);
                PubSub.publish('INVITE',{sender:ws.username,receiver:m.receiver});
                break;
            case 'ACCEPT':
                PubSub.publish('ACCEPT',{sender:m.sender,receiver:ws.username});
                break;
            case 'REJECT':
                PubSub.publish('REJECT',m.inviteId);
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
        console.log('INFO: WSS: Closing websocket...');
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
        //console.log('INFO: PeC says:');
        if(this.online[ws.username]) {
            this.online[ws.username].push(ws);
            PubSub.publish(ws.username+'.ONLINE_LIST',Object.keys(this.online));
        }
        else {
            this.online[ws.username] = [ws];
            PubSub.publish('ONLINE_LIST',Object.keys(this.online));
            //console.log('      Publish new online list:');
            //console.log(Object.keys(this.online));
        }
        //console.log('      Online object is now:');
        //console.log(this.online);
    });

    PubSub.subscribe('WS_CLOSE', (msg,ws) => {
        //console.log('INFO: PeC says:');
        if(!this.online[ws.username] || 
            (index = this.online[ws.username].indexOf(ws)) === -1)
            return;

        this.online[ws.username].splice(index,1);
        if(this.online[ws.username].length === 0) {
            //console.log('      No websoctet: waiting for reconnection...')
            setTimeout(() => {
                if(this.online[ws.username].length === 0) {
                    delete this.online[ws.username];
                    PubSub.publish('ONLINE_LIST',Object.keys(this.online));
                    //console.log('INFO: PeC says:');
                    //console.log('      Publish new online list:');
                    //console.log(Object.keys(this.online));
                }
            },1000);
        }
        //console.log('      Online object is now:');
        //console.log(this.online);
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
            PubSub.publish('NEW_TABLE',invite);
        console.log('PeC: '+invite.receiver+' accepted invite from '+invite.sender);
    });

    PubSub.subscribe('REJECT', (msg, inviteId) => {
        // Not implemented
    });

    // Remove expired invitations
    setInterval(() => {
        Object.keys(this.invites).forEach(receiver => {
            Object.keys(this.invites[receiver]).forEach(sender => {
                if(this.invites[receiver][sender] < (new Date()).getTime())
                {
                    console.log('Will delete now...');
                    delete this.invites[receiver][sender];
                }
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
