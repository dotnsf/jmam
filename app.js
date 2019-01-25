//. app.js

var express = require( 'express' ),
    cfenv = require( 'cfenv' ),
    bodyParser = require( 'body-parser' ),
    client = require( 'cheerio-httpcli' ),
    ejs = require( 'ejs' ),
    fs = require( 'fs' ),
    cloudantlib = require( '@cloudant/cloudant' ),
    mecablib = require( 'mecab-async' ),
    w2v = require( 'word2vec' ),
    app = express();
var settings = require( './settings' );

var db = null;
if( settings.db_username && settings.db_password ){
  var cloudant = cloudantlib( { account: settings.db_username, password: settings.db_password } );
  if( cloudant ){
    cloudant.db.get( settings.db_name, function( err, body ){
      if( err ){
        if( err.statusCode == 404 ){
          cloudant.db.create( settings.db_name, function( err, body ){
            if( err ){
              db = null;
            }else{
              db = cloudant.db.use( settings.db_name );
            }
          });
        }else{
          db = cloudant.db.use( settings.db_name );
        }
      }else{
        db = cloudant.db.use( settings.db_name );
      }
    });
  }
}

var mecab = new mecablib();
mecab.command = 'mecab';

var appEnv = cfenv.getAppEnv();

app.use( bodyParser.urlencoded( { extended: true } ) );
app.use( bodyParser.json() );
app.use( express.Router() );
app.use( express.static( __dirname + '/public' ) );

app.set( 'views', __dirname + '/views' );
app.set( 'view engine', 'ejs' );

client.set( 'browser', 'chrome' );
client.set( 'referer', false );

app.get( '/', function( req, res ){
  res.render( 'index', {} );
});

app.get( '/loadTextByUrl', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );
  var url = req.query.url;
  var encode = ( req.query.encode ? req.query.encode : null );
  if( url ){
    getText( url, encode ).then( function( text ){
      var p = JSON.stringify( { status: true, result: text }, null, 2 );
      res.write( p );
      res.end();
    }).catch( function( err ){
      console.log( err );
      var p = JSON.stringify( { status: false, error: err }, null, 2 );
      res.status( 400 );
      res.write( p );
      res.end();
    });
  }else{
    var p = JSON.stringify( { status: false, error: "parameter: url needed." }, null, 2 );
    res.status( 400 );
    res.write( p );
    res.end();
  }
});

app.post( '/mecabParse', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );
  var body = req.body.body;
  if( body ){
    //. maxBuffer exceeded.
    if( body.length > settings.max_letters ){ body = body.substring( 0, settings.max_letters ); }

    mecab.parseFormat( body, function( err, morphs ){
      if( err ){
        var p = JSON.stringify( { status: false, error: err }, null, 2 );
        res.status( 400 );
        res.write( p );
        res.end();
      }else{
        var result0 = [];
        var result = [];
        morphs.map( function( morph ){
          if( [ '名詞', '動詞', '形容詞', '感動詞' ].indexOf( morph.lexical ) > -1 ){
            //. morph = { kanji: 'xx', lexical: 'xx', compouond: 'xx', conjugation: 'xx', inflection: 'xx', original: 'xx', pronunciation: 'xx', reading: 'xx' }
            //. 配列の indexOf は単純配列の場合のみ？
            var morph0 = JSON.stringify( morph );

            if( result0.indexOf( morph0 ) > -1 ){
              var idx = result0.indexOf( morph0 );
              result[idx].cnt ++;
            }else{
              result0.push( morph0 );
              morph.cnt = 1;
              result.push( morph );
            }
          }
        });
        result.sort( compareByCnt ); //. ソート
        var p = JSON.stringify( { status: true, result: result }, null, 2 );
        res.write( p );
        res.end();
      }
    });
  }else{
    var p = JSON.stringify( { status: false, error: "parameter: body needed." }, null, 2 );
    res.status( 400 );
    res.write( p );
    res.end();
  }
});

app.post( '/mecabPrepareW2V', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );
  var body = req.body.body;
  if( body ){
    //. maxBuffer exceeded.
    if( body.length > settings.max_letters ){ body = body.substring( 0, settings.max_letters ); }

    mecab.parseFormat( body, function( err, morphs ){
      if( err ){
        var p = JSON.stringify( { status: false, error: err }, null, 2 );
        res.status( 400 );
        res.write( p );
        res.end();
      }else{
        var result = '';
        morphs.map( function( morph ){
          if( [ '名詞', '動詞', '形容詞', '感動詞', '記号' ].indexOf( morph.lexical ) > -1 ){
            //. morph = { kanji: 'xx', lexical: 'xx', compouond: 'xx', conjugation: 'xx', inflection: 'xx', original: 'xx', pronunciation: 'xx', reading: 'xx' }
            if( morph.lexical != '記号' ){
              result += ( ' ' + morph.kanji );
            }else{
              if( morph.compound == '句点' ){
                result += ( '.\n' );
              }else if( morph.compound == '読点' ){
                result += ( ',' );
              }
            }
          }
        });
        var p = JSON.stringify( { status: true, result: result }, null, 2 );
        res.write( p );
        res.end();
      }
    });
  }else{
    var p = JSON.stringify( { status: false, error: "parameter: body needed." }, null, 2 );
    res.status( 400 );
    res.write( p );
    res.end();
  }
});

app.post( '/w2v', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );
  var body = req.body.body;
  if( body ){
    //. body をテキストファイルとして保存
    var ts = ( new Date() ).getTime();
    var srcfilename = __dirname + '/tmp/src' + ts + '.txt';
    //console.log( 'srcfilename = ' + srcfilename );
    fs.writeFile( srcfilename, body, function( err1 ){
      if( err1 ){
        //console.log( 'err1' );
        //console.log( err1 );
        var p = JSON.stringify( { status: false, error: err1 }, null, 2 );
        res.status( 400 );
        res.write( p );
        res.end();
      }else{
        var dstfilename = __dirname + '/tmp/' + ts + '.txt';
        console.log( 'dstfilename = ' + dstfilename );
        w2v.word2vec( srcfilename, dstfilename, {
          /*
          cbow: 1,
          size: 200,
          window: 8,
          negative: 0, //25,
          hs: 0,
          sample: 1e-4,
          threads: 20,
          iter: 30,
          minCount: 2
          */
        }, function( err2 ){
          if( err2 ){
            //. https://github.com/Planeshifter/node-word2vec/issues/7 ?
            console.log( 'err2' );
            console.log( err2 );   //. 126 "Bad Request"
            var p = JSON.stringify( { status: false, error: err2 }, null, 2 );
            res.status( 400 );
            res.write( p );
            res.end();
          }else{
            var p = JSON.stringify( { status: true, model_id: ts }, null, 2 );
            res.write( p );
            res.end();
          }
          fs.unlink( srcfilename, function( err ){} );
        });
      }
    });
  }else{
    var p = JSON.stringify( { status: false, error: "parameter: body needed." }, null, 2 );
    res.status( 400 );
    res.write( p );
    res.end();
  }
});

app.post( '/similar', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );
  var model_id = req.body.model_id;
  var word = req.body.word;
  if( model_id && word ){
    var modelname = 'tmp/' + model_id + '.txt';
    w2v.loadModel( modelname, function( err, model ){
      if( err ){
        var p = JSON.stringify( { status: false, error: err }, null, 2 );
        res.status( 400 );
        res.write( p );
        res.end();
      }else{
        var words = model.mostSimilar( word, 10 );
        var p = JSON.stringify( { status: true, word: word, similarWords: words }, null, 2 );
        res.write( p );
        res.end();
      }
    });
  }else{
    var p = JSON.stringify( { status: false, error: "parameter: modelname & word needed." }, null, 2 );
    res.status( 400 );
    res.write( p );
    res.end();
  }
});


function getHTML( url, encode ){
  return new Promise( function( resolve, reject ){
    //client.set( 'heaers', { referer: 'https://product.rakuten.co.jp/' } );
    if( !encode ){ encode = 'UTF-8'; }
    client.fetch( url, {}, encode, function( err, $, res, body ){
      if( err ){
        resolve( null );
      }else{
        $('body').each( function(){
          var html = $(this).html();
          resolve( html );
        });
      }
    });
  });
}

function getText( url, encode ){
  return new Promise( function( resolve, reject ){
    //client.set( 'heaers', { referer: 'https://product.rakuten.co.jp/' } );
    if( !encode ){ encode = 'UTF-8'; }
    client.fetch( url, {}, encode, function( err, $, res, body ){
      if( err ){
        resolve( null );
      }else{
        $('body').each( function(){
          var text = $(this).text();

          text = text.split( '\\n' ).join( '' );

          resolve( text );
        });
      }
    });
  });
}

function compareByCnt( a, b ){
  var r = 0;
  if( a.cnt < b.cnt ){ r = 1; }
  else if( a.cnt > b.cnt ){ r = -1; }

  return r;
}



app.listen( appEnv.port );
console.log( "server stating on " + appEnv.port + " ..." );
