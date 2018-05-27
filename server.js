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
    console.log(req.session.username);
    res.end('done');
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
            done(info.req.session.username);
        });
    }
 });

wss.on('connection', function connection(ws,req) {
    var s = req.session;
    ws.on('message', function incoming(message) {
        m = JSON.parse(message);
        switch(m.type) {
            case 'PING':
                console.log('INFO: '+s.username+' sent a PING');
                ws.send(JSON.stringify({type:'PONG'}));
                break;
            default:
        }
    });

    ws.send(JSON.stringify({
        type:'WELCOME',
        text:'WebSocket connected. Welcome, '+s.username+'!'
    }));
});

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

/// Functions declaration
////////////////////////////////////////////////////////////////////////////////
// Functions that will perform some tasks, when called above
