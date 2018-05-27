Put here the security files for HTTPS server.

You may generate it using

$ openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem

and giving the asked info.

After that, change server.js to run https server using the password used here.
