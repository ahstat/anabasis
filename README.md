Anabasis is a webapp game where players draw pictures and try to find one special cell among 10000 cells. Some technical informations here:

* How to load the app:
  * npm install // install dependencies and create node_modules
  * mongod // launch mongo server
  * node app.js // launch app
  * SIDE=10 node app.js // launch app with env variable SIDE set to 10
  * SIDE=26 node app.js // launch app with env variable SIDE set to 26
  * foreman start web // connection to localhost, OR
  * localhost:5000 // another way to connect to localhost (in a web browser)
  * mongo // manage database

* Main files of the app:
  // css
  * style.css
  * style10.css
  * style26.css
  // html
  * contact.html
  * draws.html
  * howto.html
  * index.html
  * draws26.html
  * howto26.html
  * index26.html
  // js
  * app.js
  * game.js
  * draws.js

* Difference between side 10 and side 26:
  // to change the side from 10 to 26 (online step):
  * change env variable SIDE to 26 (used in app.js)
  // Differences between index.html and index26.html
  * static/style26.css
  * var side = 26
  // Difference between draws.html and draws26.html
  * var side = 26

* What the player can emit:
  * connection and disconnection
  // draw.js
  * socket.emit('draw_num_recent');
  * socket.emit('draw_num', num_pic + number); //parseInt then test if NaN and check if negativ or too high.
  // game.js
  * socket.emit('game');
  * socket.emit('lobby');
  * socket.emit('room', id_table); //parseInt (then int or NaN). To be OK, must not be NaN, must not be negative or >= side2.
  // critical game.js functions (write to mongodb)
  * socket.emit('new_seen_cell', {id_table: id_table, id_cell: parseInt(this.id)}); //parseInt for 'new_seen_cell' variables (then int or NaN). To be OK, must not be NaN, must not be negative or >= side2.
  * socket.emit('send_nickname', nickname); // check for string, then ent encode.

* Quick functions for mongo:
  * use mydb
  // find
  * db.attempts.find()
  * db.attempts.find().forEach(printjson); // print all
  * db.wins.find()
  * db.nicknames.find()
  * db.passes.find()
  * db.bans.find()
  // remove
  * db.attempts.remove()
  * db.wins.remove()
  * db.nicknames.remove()
  * db.passes.remove()
  * db.bans.remove()
