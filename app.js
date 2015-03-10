var http = require('http'),
  url = require('url'),
  fs = require('fs'),
  ent = require('ent'), // to prevent users to use html code
  shortid = require('shortid'),
  express = require('express'),
  request = require('request'),
  mongoClient = require('mongodb').MongoClient,
  mongoose = require('mongoose'),
  // http://stackoverflow.com/questions/14009792/nodejs-pixel-manipulation-library
  fs = require('fs'),
  PNG = require('pngjs').PNG;

///////////////////////////
//  Main initialization  //
///////////////////////////
var vault_num = 0, // number of vaults opened (begin with 1). Here a vault is an artwork, a draw, with one special cell.
  true_pass = 0; // current pass to find (depend of the side. From 0 to 9999 with side = 10).

var num_players = 0; // number of players

//for drawing artworks
var wins_num = []; //an array of the vault_num in 'wins' database, usually [1, 2, 3, 4, 5, ...]
var wins_date = []; //an array of the date in 'wins' database in posix, i.e. [1425576265.254, ...]
var imgPath = ""; //path of the win image (to save to mongo)
var nick_num = []; //an array of the vault_num in 'nicknames' database, usually [1, 2, 3, 4, 5, ...] (except if the winner have not clicked on "OK" of "Cancel" when the prompt opens).
var nick_name = []; //an array of the nickname (name of artworks) in 'nicknames' database, usually [name1, ...] (related to nick_num).

//for banned players
var bans_ip = []; //an array of banned ip

///////////////////////////
//  Side initialization  //
///////////////////////////
console.log(process.env.SIDE + ' is the side length.');
var side = process.env.SIDE //the side of the square, 10 or 26. Then, there are side^4 cells. side must be < 101.
var side2 = side * side
var side4 = side2 * side2

if( !(side==10 || side==26) ) {
  console.log("ERROR, you have to set global env variable SIDE with SIDE=10 or SIDE=26.")
}

var passIndex = 100
if(side <= 10) {
  passIndex = 100 // pass from 0 to 9999, eg 4331 = 43/31 (room 43 and cell 31).
}
else if(side <= 31) {
  passIndex = 1000 // pass from 0 to 999999, eg 128331 = 128/331 (room 128 and cell 331).
}
else if(side <= 100) { 
  passIndex = 10000 // pass from 0 to 99999999, eg 12483231 = 1248/3231 (room 1248 and cell 3231).
}
else {
  console.log("ERROR, side too large");
}

////////////////////////////
//  Table initialization  //
////////////////////////////
//my_draw is the main side^2 table (rooms) of table (cells): each room having side^2 cells.
var my_draw = new Array(side2);
for (var i = 0; i < side2; i++) {
  my_draw[i] = Array.apply(null, new Array(side2)).map(Number.prototype.valueOf,0); //Array(side2);
}
//example of a room (0 means dark/non-clicked and 1 means light/clicked)
/*var seen_list = [
0,0,0,1,1,0,1,1,0,0,
0,0,1,1,1,1,1,1,0,0,
0,0,0,1,1,0,0,1,0,0,
0,0,0,0,0,1,1,1,1,0,
0,0,0,0,0,0,1,1,0,0,
0,0,0,0,1,0,0,0,0,0,
0,0,0,0,0,1,0,0,0,0,
0,0,0,0,0,0,1,0,0,0,
0,0,0,0,0,0,0,1,0,0,
0,0,0,0,0,0,0,0,1,0
];
my_draw[92] = seen_list;*/

var my_draw_old; //useful to export a finished draw (when someone win), while a new draw is incoming

///////////////////////////////////////////
//  Schema and model creation for mongo  //
///////////////////////////////////////////
// http://atinux.developpez.com/tutoriels/javascript/mongodb-nodejs-mongoose/
// schema creation
var attemptsSchema = new mongoose.Schema({
  date : { },
  id : { },
  ip : { },
  pass : { },
  vault_num : { }
});
// model creation
var AttemptsModel = mongoose.model('attempts', attemptsSchema);

var winsSchema = new mongoose.Schema({
  date : { },
  id : { },
  ip : { },
  pass : { },
  vault_num : { },
  image : { }
});
var WinsModel = mongoose.model('wins', winsSchema);

var nickSchema = new mongoose.Schema({
  vault_num : { },
  nickname : { }
});
var NickModel = mongoose.model('nicknames', nickSchema);

var passesSchema = new mongoose.Schema({
  vault_num : { },
  pass : { }
});
var PassesModel = mongoose.model('passes', passesSchema);

var bansSchema = new mongoose.Schema({
  date : { },
  ip : { },
  why : { }
});
var BansModel = mongoose.model('bans', bansSchema);

//////////////////////////////
//  Server start functions  // [HELPER FUNCTIONS]
//////////////////////////////
// Server start, try to find saved things
var initialization_check_vault = function() { 
  // http://stackoverflow.com/questions/4299991/how-to-sort-in-mongoose
  var query_passes = PassesModel.find(null).sort({ vault_num : "desc"}).limit(1); //the first one is the most recent
  mongo_pass_query(query_passes); // try to find saved passes

  var query_wins = WinsModel.find(null).sort({ vault_num : "asc"}); // try to find saved wins (names and dates)
  mongo_win_query(query_wins);

  var query_nick = NickModel.find(null).sort({ vault_num : "asc"}); // try to find saved nicks
  mongo_nick_query(query_nick);

  var query_bans = BansModel.find(null).sort({ date : "asc"}); // try to find saved banned players
  mongo_ban_query(query_bans);
}

// Query functions at the start of the server, related to initialization_check_vault
var mongo_pass_query = function(query) {
  query.exec(function (err, comms) {
    if(err) {
      throw err;
    }
    if(comms.length != 0) { // file is not empty, taking the last pass
      console.log("Server restarted, retrieving the current pass");
      vault_num = comms[0].vault_num;
      true_pass = comms[0].pass;
      console.log('>>> Current secret pass: ' + true_pass + ' (vault ' + vault_num + ') <<<');
      update_table_from_mongo();
    }
    else { // file is empty, it's the first start of the server
      console.log("First launch of the app, creating the new pass");
      add_new_vault();
    }
  });
}

var mongo_win_query = function(query) {
  query.exec(function (err, comms) {
    if(err) {
      throw err;
    }

    wins_num = new Array(comms.length);
    //wins_name = new Array(comms.length);
    wins_date = new Array(comms.length);

    //console.log("Retrieving dates");
    for (var i = 0; i < comms.length; i++) {
      wins_num[i] = comms[i].vault_num
      wins_date[i] = comms[i].date
      //console.log(wins_num[i]);
      //console.log(wins_date[i]);
      process_image_launch(comms[i].image, wins_num[i]);
    }
  });
}

var mongo_nick_query = function(query) {
  query.exec(function (err, comms) {
    if(err) {
      throw err;
    }

    nick_name = new Array(comms.length);
    nick_num = new Array(comms.length);

    //console.log("Retrieving names");
    for (var i = 0; i < comms.length; i++) {
      nick_num[i] = comms[i].vault_num
      nick_name[i] = comms[i].nickname
      //console.log(nick_num[i]);
      //console.log(nick_name[i]);
    }
  });
}

var mongo_ban_query = function(query) {
  query.exec(function (err, comms) {
    if(err) {
      throw err;
    }

    bans_ip = new Array(comms.length);

    console.log("Retrieving banned players");
    for (var i = 0; i < comms.length; i++) {
      bans_ip[i] = comms[i].ip
      console.log(bans_ip[i]);
    }
    console.log('End of banned players');
  });
}

///////////////////////////
//  New vault functions  // [HELPER FUNCTIONS]
///////////////////////////
// First launch of the server or someone wins, new vault to open (i.e. new special cell among side^4 cells to find)
var add_new_vault = function() {
  //console.log("New vault, new pass to get !");
  vault_num++;

  // Math.floor(side2*Math.random()):
  //  if side2=10*10=100, from 0 to 99 (inclusive)
  //  if side2=26*26=676, from 0 to 675 (inclusive)
  // then true_pass:
  //  if side=10, then passIndex=100 thus from 100*[0,99]+[0,99] i.e. from 0 to 9999.
  //  if side=26, then passIndex=1000 thus from 1000*[0,675] + [0,675].
  true_pass = passIndex * Math.floor(side2*Math.random()) + Math.floor(side2*Math.random());

  //now, update the database passes
  //mongo connexion
  var add_pass = new PassesModel();
  add_pass.vault_num = vault_num;
  add_pass.pass = true_pass;

  add_pass.save(function (err) {
    if(err) {
      console.log("mongo: failed to insert add_pass"); throw err;
    }
    //console.log("mongo: inserted add_pass ");
  });
  //mongo connexion end

  console.log('>>> New secret pass: ' + true_pass + ' (vault ' + vault_num + ') <<<');
  update_table_from_mongo();
}

// Function when a player found a pass
var new_vault_player = function(socket) {
  if(vault_num < 10000) {
    add_new_vault();
    update_lobby_colors();
    socket.emit('b', {colors: colors, new_game: 1});
    socket.broadcast.emit('b', {colors: colors, new_game: 1});
  } 
  else {
    console.log('>>> End of the game <<<');
    true_pass = -1;
  }
}

// Take the data from mongo and write it in the main 'my_draw' table (of length size^4).
var update_table_from_mongo = function() {
  for (var i = 0; i < side2; i++) {
    my_draw[i] = Array.apply(null, new Array(side2)).map(Number.prototype.valueOf,0); //Array(side2);
  }

  var query0 = AttemptsModel.find({ vault_num: vault_num }).sort({ pass : "asc"});
  query0.exec(function (err, comms) {
    if(err) {
      throw err;
    }
    if(comms.length != 0) { // file is not empty, taking the last pass
      for (var i = 0; i < comms.length; i++) {
        //console.log("already " + comms[i].pass);
        let_seen(comms[i].pass);
      }
    }
    else { // le fichier est vide
    }
  });
}

var let_seen = function(pass) {
  var table_num = Math.floor(pass / passIndex);
  var cell_num = pass - passIndex*table_num
  my_draw[table_num][cell_num] = 1;
  //console.log(table_num + " and " + cell_num);
  //console.log(my_draw[table_num][cell_num]);
}

///////////////////////////////////////
//  Lobby color of squares function  // [HELPER FUNCTIONS]
///////////////////////////////////////
//colors corresponds to the means of the cells in each room (how much % is seen).
var colors = new Array(side2);

var update_lobby_colors = function() {
  for(var i = 0; i < side2; i++){
    colors[i] = mean(my_draw[i]);
  }
}

var mean = function(array) {
  out = 0;
  for(var j = 0; j < side2; j++) {
    out += array[j];
  }
  return(out/side2);
}

////////////////////////
//  Export functions  // [HELPER FUNCTIONS]
////////////////////////
var convert_function = function(x,y, size_cell, data_draw)
{
 //x between 0 and 99
 //y between 0 and 99
 x = Math.floor(x/size_cell);
 y = Math.floor(y/size_cell);

 var table_unit = Math.floor(x/side);
 var table_tens = Math.floor(y/side);
 var table_ok = side*table_tens + table_unit;

 var cell_unit = x - side*table_unit
 var cell_tens = y - side*table_tens
 var cell_ok = side*cell_tens + cell_unit; 

 //console.log("(" + table_ok + "," + cell_ok + ") = " + my_draw[table_ok][cell_ok]);
 return data_draw[table_ok][cell_ok];
}

// http://stackoverflow.com/questions/8459896/auto-update-image
var png10 = function(index_image, data_draw) {
console.log("Creation of image" + index_image + ".png.");
//var index_image = 0;
fs.createReadStream(__dirname + '/static/img/raw_square10.png')
  .pipe(new PNG({
    filterType: 4
  }))
  .on('parsed', function() {
    for (var y = 0; y < this.height; y++) {
      for (var x = 0; x < this.width; x++) {
        var idx = (this.width * y + x) << 2;
        //var array_index = this.width * y + x;
        if(convert_function(x,y,6, data_draw) == 0) { // the size of each cell is 6x6, then the picture is 600x600
          // invert color
          this.data[idx] = 0;
          this.data[idx+1] = 67;
          this.data[idx+2] = 102;
        }
        else {
          this.data[idx] = 153;
          this.data[idx+1] = 221;
          this.data[idx+2] = 255;
        }
      }
    }
    this.pack().pipe(fs.createWriteStream(__dirname + '/static/draws/10/image'+index_image+'.png'));
  });

  imgPath = __dirname + '/static/draws/10/image'+index_image+'.png'
}

var png26 = function(index_image, data_draw) {
console.log("Creation of big image" + index_image + ".png.");
//var index_image = 0;
fs.createReadStream(__dirname + '/static/img/raw_square26.png')
  .pipe(new PNG({
    filterType: 4
  }))
  .on('parsed', function() {
    for (var y = 0; y < this.height; y++) {
      for (var x = 0; x < this.width; x++) {
        var idx = (this.width * y + x) << 2;
        //var array_index = this.width * y + x;
        if(convert_function(x,y,1, data_draw) == 0) { // the size of each cell is 1x1, then the picture is 676x676
          // invert color
          this.data[idx] = 0;
          this.data[idx+1] = 67;
          this.data[idx+2] = 102;
        }
        else {
          this.data[idx] = 153;
          this.data[idx+1] = 221;
          this.data[idx+2] = 255;
        }
      }
    }
    this.pack().pipe(fs.createWriteStream(__dirname + '/static/draws/26/image'+index_image+'.png'));
  });

  imgPath = __dirname + '/static/draws/26/image'+index_image+'.png'
}

var process_image_launch = function(data, index_image) {
  if (typeof data === 'undefined') {
    console.log("Undefined for image" + index_image + ".png")
  }
  else {
    if(side == 10) {
      png10(index_image, data);
    }
    else {
      png26(index_image, data);
    }
  }
}

///////////////////////////////////////////////////
//  Function when a player connects/disconnects  // [HELPER FUNCTIONS]
///////////////////////////////////////////////////
var player_send_html = function(socket) {
  console.log('Now ' + num_players + ' player(s).');
  if(num_players==1) {
    player_text = 'player';
  }
  else {
    player_text = 'players';
  }
  socket.message = num_players + ' ' + player_text + '';
  socket.emit('p', socket.message);
  socket.broadcast.emit('p', socket.message);
}

////////////////////////////////////////////
//  Legend of title for draw.js function  // [HELPER FUNCTIONS]
////////////////////////////////////////////
// from https://blog.serverdensity.com/automatic-timezone-conversion-in-javascript/
var get_date = function(timestamp) {
  // Multiply by 1000 because JS works in milliseconds instead of the UNIX seconds
  var date = new Date(timestamp * 1000);
         
  var year    = date.getUTCFullYear();
  var month   = date.getUTCMonth() + 1; // getMonth() is zero-indexed, so we'll increment to get the correct month number
  var day     = date.getUTCDate();
  /*var hours   = date.getUTCHours();
  var minutes = date.getUTCMinutes();
  var seconds = date.getUTCSeconds();*/
         
  /*month   = (month < 10) ? '0' + month : month;
  day     = (day < 10) ? '0' + day : day;
  hours   = (hours < 10) ? '0' + hours : hours;
  minutes = (minutes < 10) ? '0' + minutes : minutes;
  seconds = (seconds < 10) ? '0' + seconds: seconds;*/

  var monthLetter = ""
  switch(month) {
    case 1:
      monthLetter = "Jan"
      break;
    case 2:
      monthLetter = "Feb"
      break;
    case 3:
      monthLetter = "Mar"
      break;
    case 4:
      monthLetter = "Apr"
      break;
    case 5:
      monthLetter = "May"
      break;
    case 6:
      monthLetter = "Jun"
      break;
    case 7:
      monthLetter = "Jul"
      break;
    case 8:
      monthLetter = "Aug"
      break;
    case 9:
      monthLetter = "Sep"
      break;
    case 10:
      monthLetter = "Oct"
      break;
    case 11:
      monthLetter = "Nov"
      break;
    case 12:
      monthLetter = "Dec"
      break;
    default:
      monthLetter = "NA"
  }
  return day + " " + monthLetter + " " + year;       
}

///////////////////////////////////////////////////////////////////////////////
//  Connection to the mongo database and table initialization from database  //
///////////////////////////////////////////////////////////////////////////////
// http://stackoverflow.com/questions/13200810/getting-herokus-config-vars-to-work-in-node-js
if(side == 10) {
  //mongoose.connect("mongodb://127.0.0.1:27017/mydb", function(err) {
  mongoose.connect("mongodb://" + process.env.MONGOLAB_ANABASIS_USER + ":" + process.env.MONGOLAB_ANABASIS_PASS + "@ds033669.mongolab.com:33669/anabasis", function(err) {
    if(err) {
      throw err;
    }
  });
}
else { // side should be 26 here
  //mongoose.connect("mongodb://127.0.0.1:27017/mydb26", function(err) {
  mongoose.connect("mongodb://" + process.env.MONGOLAB_ANABASIS_USER + ":" + process.env.MONGOLAB_ANABASIS26_PASS + "@ds029257.mongolab.com:29257/anabasis26", function(err) {
    if(err) {
      throw err;
    }
  });  
}

initialization_check_vault();

////////////////////////////////////
//  App initialization and roads  //
////////////////////////////////////
var app = express();
app.use("/static", express.static(__dirname + '/static'));

if(side==10) {
  app.get('/', function(req, res) {
    fs.readFile('./index.html', 'utf-8', function(error, content) {
      res.writeHead(200, {"Content-Type": "text/html"});
      res.end(content);
    });
  });

  app.get('/draws.html', function(req, res) {
    fs.readFile('./draws.html', 'utf-8', function(error, content) {
      res.writeHead(200, {"Content-Type": "text/html"});
      res.end(content);
    });
  });

  app.get('/howto.html', function(req, res) {
    fs.readFile('./howto.html', 'utf-8', function(error, content) {
      res.writeHead(200, {"Content-Type": "text/html"});
      res.end(content);
    });
  });
}
else { //side==26
  app.get('/', function(req, res) {
    fs.readFile('./index26.html', 'utf-8', function(error, content) { //index26.html
      res.writeHead(200, {"Content-Type": "text/html"});
      res.end(content);
    });
  });

  app.get('/draws.html', function(req, res) {
    fs.readFile('./draws26.html', 'utf-8', function(error, content) { //draws26.html
      res.writeHead(200, {"Content-Type": "text/html"});
      res.end(content);
    });
  });

  app.get('/howto.html', function(req, res) {
    fs.readFile('./howto26.html', 'utf-8', function(error, content) {
      res.writeHead(200, {"Content-Type": "text/html"});
      res.end(content);
    });
  });
}

app.get('/contact.html', function(req, res) {
  fs.readFile('./contact.html', 'utf-8', function(error, content) {
    res.writeHead(200, {"Content-Type": "text/html"});
    res.end(content);
  });
});

app.use(function(req, res, next){
  res.redirect('/');
});

app.set('port', (process.env.PORT || 5000))
var server = app.listen(app.get('port'));

////////////////////////////
//  Socket main function  //
////////////////////////////
var io = require('socket.io').listen(server);

io.sockets.on('connection', function (socket) { // each socket is linked to a player. This function ends at the end of the code.

  socket.where = 'not_in_game'; //where the player stands: on the game page or not?
  socket.emit('o'); // see if the page is related to draws.js (answer 'draw_num_recent') or game.js (answer 'game').

  ////////////////
  //  draws.js  //
  ////////////////
  socket.on('d', function() {
    draw_picture(Math.max.apply(Math, wins_num)); //most recent number of a finished draw
  })

  socket.on('e', function(i) {
    i = parseInt(i);
    if(isNaN(i)) {
    }
    else {
      max_num = Math.max.apply(Math, wins_num)
      if(i>=1 && i<=max_num) {
        draw_picture(i);
      }
      else if(i <= 0) {
        draw_picture(max_num);
      }
      else if(i > max_num) {
        draw_picture(1);
      }
    }
  })

  var draw_picture = function(i) { // related to socket.on 'draw_num_recent' & 'draw_num'.
    if(i==-Infinity) {
    var num_draw = "is not finished";
    var date_draw = "O_o";
    var title_draw = "come back after";
    }
    else {
      var j = wins_num.indexOf(i);
      var num_draw = wins_num[j];
      var date_draw = get_date(wins_date[j]);

      var k = nick_num.indexOf(i);
      var title_draw = nick_name[k];
    }
    socket.emit('a', {num_draw: num_draw, title_draw: title_draw, date_draw: date_draw});
  }

  //////////////////////
  //  game.js launch  //
  //////////////////////
  socket.on('g', function() {
    // player update
    if(socket.where == 'not_in_game') {
      socket.where = 'in_game';
      num_players++
      player_send_html(socket);
    }

    // ip
    socket.ip_player = socket.handshake.headers['x-forwarded-for'];
    if (!socket.ip_player){
      socket.ip_player = socket.conn.remoteAddress;
    }

    socket.ban = false;
    check_banned(); //modify socket.ban to true if the player is already banned
    socket.ban_gauge = 0;

    // id 
    socket.id_player = shortid.generate();

    draw_lobby();
  })

  var check_banned = function() {
    var seek_for_banned = bans_ip.indexOf(socket.ip_player);
    if(seek_for_banned != -1) {
      console.log("Connection of a banned player: " + socket.ip_player + ".");
      socket.ban = true;
    }
  }

  ////////////////////////////////////////////
  //  game.js going to the lobby or a room  //
  ////////////////////////////////////////////
  socket.on('l', function() {
    draw_lobby();
  })

  socket.on('r', function(id_table) {
    socket.current_table = parseInt(id_table);
    // console.log(socket.current_table);
    if(isNaN(socket.current_table) || socket.current_table < 0 || socket.current_table >= side2) {
    }
    else {
      socket.emit('c', my_draw[socket.current_table]);
    }
  })

  var draw_lobby = function() {
    update_lobby_colors();
    //console.log(colors);
    socket.current_table = -1;
    socket.emit('b', {colors: colors, new_game: 0});
  }

  //////////////////////////////
  //  game.js cell discovery  //
  //////////////////////////////
  socket.on('n', function(data) {
    if(socket.ban == true) { // ignore him!
      // console.log("He's already banned.");
    }
    else {
      socket.newDate = Date.now()/1000; //date in seconds
      socket.table = parseInt(data.id_table);
      socket.cell = parseInt(data.id_cell);
      socket.pass = passIndex*socket.table + socket.cell;

      bad_attempts_test();

      if(socket.ban == true) { // ignore him!
      }
      else {
        if(!isNaN(socket.pass)) {
          cell_process();
          if(socket.pass == true_pass) {
            win_cell_process();
          }
          socket.oldDate = socket.newDate;
        }
      }
    }
  })

  // check if the player made a bad attempt... If it is bad, the ban_gauge increases. If ban_gauge > 100, then the player is banned.
  var bad_attempts_test = function() {
    if(socket.table < 0 || socket.table >= side2 || isNaN(socket.table)) {
      socket.ban_gauge += 100;
      socket.ban_why = "outside_lobby_table";
      console.log('Bad emission of ' + socket.ip_player + ': socket.table=' + socket.table + '. Gauge: ' + socket.ban_gauge + '%.');
    }
    else if(socket.cell < 0 || socket.cell >= side2 || isNaN(socket.cell)) {
      socket.ban_gauge += 100;
      socket.ban_why = "outside_room_table";
      console.log('Bad emission of ' + socket.ip_player + ': socket.cell=' + socket.cell + '. Gauge: ' + socket.ban_gauge + '%.');
    }
    else {
      if(socket.newDate - socket.oldDate < 0.15) {
        socket.ban_gauge += 5;
        socket.ban_why = "close_attempts_" + 1000*(socket.newDate - socket.oldDate) +"ms";
        console.log('Too close attempts of ' + socket.ip_player + 
                    ': Delta = ' + (socket.newDate - socket.oldDate) + 
                    's. Gauge: ' + socket.ban_gauge + '%.');
        //against : 
        //for (var i=0; i<side2; i++) {
        //  socket.emit('new_seen_cell', {id_table: 1, id_cell: ''+i});
        //}
      }

      if(socket.newDate - socket.oldDate < 0.08) {
        socket.ban_gauge += 5;
        socket.ban_why = "close_attempts_" + 1000*(socket.newDate - socket.oldDate) +"ms";
        console.log('Too too close attempts of ' + socket.ip_player + 
                    ': Delta = ' + (socket.newDate - socket.oldDate) + 
                    's! Gauge: ' + socket.ban_gauge + '%.');
      }

      if(my_draw[socket.table][socket.cell] == 1) { // already clicked = impossible, except if a bug occurs. Warning: we have to be sure that socket.table >= 0 and socket.cell >= 0 (else throws an error).
        socket.ban_gauge += 30;
        socket.ban_why = "click_seen_square";
        console.log('Click on a seen square by ' + socket.ip_player + 
                    ': square = (' + socket.table + ', ' + socket.cell + '). Gauge: ' + socket.ban_gauge + '%.');
      }
    }

    if(socket.ban_gauge >= 100) {
      activate_ban();
    }
  }

  // activation of bannishment (socket + mongo). Note: if a player has multiple sockets opened when banned, only one of these is banned.
  var activate_ban = function() {
    socket.ban = true;

    //mongo connexion
    var ban = new BansModel();
    ban.date = socket.newDate;
    ban.ip = socket.ip_player;
    ban.why = socket.ban_why;

    ban.save(function (err) {
      if(err) {
        console.log("mongo: failed to insert ban"); throw err;
      }
      console.log("mongo: inserted ban of " + ban.ip + ".");
    });
    //mongo connexion end

    bans_ip.push(ban.ip);
  }

  // functions to add the seen cell to the database and update tables
  var cell_process = function() {

    console.log('( date: ' + socket.newDate + ' / pass: ' + socket.pass +
                ' / vault_num: ' + vault_num + ' / id: ' + socket.id_player + 
                ' / ip: ' + socket.ip_player + ')');

    cell_mongo_add();

    socket.win_vault_num = 0;

    my_draw[socket.table][socket.cell] = 1;
    update_lobby_colors();
    socket.broadcast.emit('z', {id_table: socket.table, id_cell: socket.cell, colors: colors});
  }

  var cell_mongo_add = function() {
    //mongo connexion
    var attempt = new AttemptsModel();
    attempt.date = socket.newDate;
    attempt.id = socket.id_player;
    attempt.ip = socket.ip_player;
    attempt.pass = socket.pass;
    attempt.vault_num = vault_num;

    attempt.save(function (err) {
      if(err) {
        console.log("mongo: failed to insert attempt"); throw err;
      }
      console.log("mongo: inserted attempt ");
    });
    //mongo connexion end
  }

  // functions to add the seen win cell to the database and update tables
  var win_cell_process = function() {
    my_draw_old = JSON.parse(JSON.stringify(my_draw));

    // export png image
    if(side == 10) {
      png10(vault_num, my_draw_old); 
    }
    else if(side == 26) {
      png26(vault_num, my_draw_old);
    }
    else {
      console.log("ERROR: side should be 10 or 26");
      png26(vault_num, my_draw_old);
    }

    win_cell_mongo_add();

    socket.emit('vv');
    socket.broadcast.emit('f');
    socket.win_vault_num = vault_num;

    new_vault_player(socket);
  }

  var win_cell_mongo_add = function() {
    //mongo connexion
    var win = new WinsModel();
    win.date = socket.newDate;
    win.id = socket.id_player;
    win.ip = socket.ip_player;
    win.pass = socket.pass;
    win.vault_num = vault_num;
    win.image = my_draw_old;
    //win.nickname = socket.nickname;

    win.save(function (err) {
      if(err) {
        console.log("mongo: failed to insert wins"); throw err;
      }
      console.log("mongo: inserted wins ");
    });
    //mongo connexion end 

    wins_num.push(win.vault_num);
    wins_date.push(win.date);
  }

  /////////////////////////////
  //  game.js win procedure  //
  /////////////////////////////
  // Asking the nickname when the player wins
  socket.on('v', function(nickname) {
    if(socket.win_vault_num > 0) {
      if(nickname == null) {
        nickname = 'anonymous'; 
      }
      else if( !(typeof nickname == 'string' || nickname instanceof String) ) {
        nickname = 'anonymous'; 
      }
      if(nickname.length > 30) { //abcdefghijklmnopqrstuvwxyz
        nickname = nickname.substr(0, 30);
      }
      socket.nickname = ent.encode(nickname);         

      //mongo connexion
      var nick = new NickModel(); //NickModel
      nick.vault_num = socket.win_vault_num;
      nick.nickname = socket.nickname;
      nick.save(function (err) {
        if(err) {
          console.log("mongo: failed to insert nick"); throw err;
        }
        console.log("mongo: inserted nick");
      });
      //mongo connexion end

      nick_num.push(nick.vault_num);
      nick_name.push(nick.nickname);

      socket.emit('f');
      socket.win_vault_num = 0;
    }
    else {
      // not in accordance with the code
      socket.ban_gauge += 30;
      socket.ban_why = "emission_win_but_dont_win";
      console.log('Bad emission of ' + socket.ip_player + ': socket.win_vault_num=0. Gauge: ' + socket.ban_gauge + '%.');
    }
  });

  ////////////////////////
  //  game.js fake win  //
  ////////////////////////
  socket.on('s', function(nickname) {
    // not in accordance with the code
    socket.ban_gauge += 30;
    socket.ban_why = "fake_win_1";
    console.log('Bad emission of ' + socket.ip_player + ': fake_win_1. Gauge: ' + socket.ban_gauge + '%.');
  })

  socket.on('t', function(nickname) {
    // not in accordance with the code
    socket.ban_gauge += 30;
    socket.ban_why = "fake_win_2";
    console.log('Bad emission of ' + socket.ip_player + ': fake_win_2. Gauge: ' + socket.ban_gauge + '%.');
  })

  socket.on('u', function(nickname) {
    // not in accordance with the code
    socket.ban_gauge += 30;
    socket.ban_why = "fake_win_3";
    console.log('Bad emission of ' + socket.ip_player + ': fake_win_3. Gauge: ' + socket.ban_gauge + '%.');
  })

  socket.on('w', function(nickname) {
    // not in accordance with the code
    socket.ban_gauge += 30;
    socket.ban_why = "fake_win_4";
    console.log('Bad emission of ' + socket.ip_player + ': fake_win_4. Gauge: ' + socket.ban_gauge + '%.');
  })

  socket.on('x', function(nickname) {
    // not in accordance with the code
    socket.ban_gauge += 30;
    socket.ban_why = "fake_win_5";
    console.log('Bad emission of ' + socket.ip_player + ': fake_win_5. Gauge: ' + socket.ban_gauge + '%.');
  })

  /////////////////////////////////////////
  //  game.js disconnection of a player  //
  /////////////////////////////////////////
  socket.on('disconnect', function () {
    if(socket.where == 'in_game') {
      num_players--
      player_send_html(socket);
    }
  });

});
