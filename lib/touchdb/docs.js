//
// MediaManagerStorage/lib/touchdb/docs.js: Decorates a document with REST methods to interact with touchdb / couchdb.
//
//  CRUD methods are provided which do not operate on an already created instance of a document, but return one. These
//  include:
//
//    docFactory(className, attr, callback): Creates a new document, given a className and attr.
//    read = function(id, callback): Return a document by ID.
//    update = function(id, attr, callback):
//    del = function(id, callback):
//
//  Documents which are created using docFactory are decorated with index, create, read, update and del
//  methods. Specifically:
//
//    Instance methods:
//
//      read(callback): Returns the doc. itself.
//      update(attr, callback): Updates the doc. with attr.
//      del(callback): Deletes the document.
//
//    Class methods:
//
//      index(query, callback)
//      create(attr, callback)
//      read(id, callback): Returns the doc. itself.
//      update(id, attr, callback): Updates the doc. with attr.
//      del(id, callback): Deletes the document.
//    
//  Notice that read, update, and del are overloaded. When an id is passed, the method operates the
//  document of that ID. Without an ID, the method is applied on the current instance.
//

var util = require('util');
var _ = require('underscore');
var log4js = require('log4js');
var uuid  = require('node-uuid');
var nano = require('nano');

var dataModel = require('../data-model');

var moduleName = './lib/touchdb/docs';

var logger = log4js.getLogger('plm.MediaManagerStorage.touchdb');

var nanoLog = log4js.getLogger('plm.MediaManagerStorage.touchdb.nano');

var nanoLogFunc = function(eventId, args) {
  var logStr = '';
  if (eventId) {
    logStr = 'event - ' + eventId;
  }
  if (args && args.length) {
    for (var i = 0; i < args.length; ++i) {
      try {
        logStr = logStr + ', ' + JSON.stringify(args[i]);
      }
      catch (e) {
        logStr = logStr + ', ' + args[i].toString();
      }
    }
  }
  nanoLog.debug(logStr);
};

var genOid = function genOid() {
  return uuid.v4();
};

//
// docPrototype: Defines index, create, read, update and del (delete)
//  methods. There are two flavors of methods, those that operate
//  on collections, and those that operate on instances of a 
//  particular document.
//
//  Collection methods:
//    index = function(query, callback) {};
//    create = function(attr, callback)  {};
//    read = function(id, callback) {};
//    update = function(id, attr, callback) {};
//    del = function(id, callback) {};
//
//  Instance methods:
//
//    update = function(attr, callback) {};
//    del = function(callback) {};
//
//  read, update, and del are overloaded. When an id is passed,
//  a _findById(id) is invoked to get a copy of the document,
//  and in the case of:
//    read - the document is returned.
//    update - _update(attr) and _save are performed.
//    del - _delete is performed.
//
//  Generic _save and _delete methods are implemented to save a doc. instance
//  or delete a doc. instance from the DB. These are:
//
//    _save(doc, callback)
//    _delete(doc, callback)
//
//  A particular type of document MUST implement the following methods:
//
//    _index(query, callback): find itself based upon a query.
//    _findById(id, callback): Find itself by ID.
//    _update(attr): A method which merges any attributes
//
var docPrototype = function(className, config) {

  var logPrefix = moduleName + '.docPrototype: ';

  var dbHost = config.local.host ? config.local.host : 'localhost'; 
  var dbUrl = 'http://' + dbHost;

  if (_.has(config.local, 'port')) {
    dbUrl = dbUrl +  ':' + config.local.port;
  }

  dbUrl = dbUrl + '/' + config.database;

  var db = nano({ url: dbUrl,
                  log: nanoLogFunc
                });

  var index = function(query, callback) {
    _index(query, callback);
  };

  var create = function(attr, callback)  {
    attr = attr || {};
    attr.oid = attr.oid || genOid();
    logger.info(logPrefix + 'creating document, w/ attr - ' + attr);
    var doc = _inst(dataModel.docFactory(className, attr));
    logger.info(logPrefix + 'Doc created, about to save...');
    _save(doc, function(error, saved) {
      if (error) {
        callback(error, saved);
      }
      else {
        callback(undefined, saved);
      }
    });
  };

  var read = function(id, callback) {
    var lp = moduleName + '.docPrototype._read: ';
    db.get(id, null, function(err, body) {
      if (err) {
        callback(err, body);
      }
      else {
        var doc = _inst(dataModel.docFactory(body.class_name, body));
        callback(undefined, doc);
      }
    });
  };

  var update = function(id, attr, callback) {
    //
    // Look at what image service does for Importer.update.
    //
    throw "Unsupported...";
  };

  var del = function(id, callback) {
    if (typeof(id) === 'string') {
      var doc = _findById(id, function(error, doc) {
        if (error) {
          callback(error);
        }
        else {
          _delete(doc, function(error) {
            if (error) {
              callback(error);
            }
            else {
              doc = undefined;
              callback();
            }
          });
        }
      });
    }
    else {
      _delete(doc, function(error) {
        if (error) {
          callback(error);
        }
        else {
          doc = undefined;
          callback();
        }
      });
    }
  };

  //
  // _inst: Create an instance of doc., which is annotated with:
  //
  //    instance methods:
  //
  //      read(callback): Returns the doc. itself.
  //      update(attr, callback): Updates the doc. with attr.
  //      del(callback): Deletes the document.
  //
  //    class methods:
  //
  //      create(attr, callback)
  //      read(id, callback): Returns the doc. itself.
  //      update(id, attr, callback): Updates the doc. with attr.
  //
  var _inst = function(doc) {
    return Object.create(doc,
                         {
                           read: {
                             value: function(id, callback) {
                               if (callback) {
                                 return this.prototype.read(id, callback);
                               }
                               else {
                                 return this;
                               }
                             }
                           },
                           update: {
                             value: function(id, attr, callback) {
                               var lp = moduleName + '.docPrototype._inst.update: ';

                               if (callback) {
                                 logger.debug(lp + 'Updating for id - ' + id + ', w/ attr - ' + JSON.stringify(attr));
                                 return this.prototype.update(id, attr, callback);
                               }
                               else {
                                 callback = attr;
                                 attr = id;

                                 logger.debug(lp + 'Update w/ attr - ' + JSON.stringify(attr));
                                 
                                 this._update(attr);
                                 _save(this, callback);
                                 return this;
                               }
                             }
                           }
                         });
  };

  //
  // _save: Persist doc to touch/couchdb.
  //
  var _save = function(doc, callback) {
    var lp = moduleName + '.docPrototype._save: ';

    var jDoc = _toCouch(doc);
    logger.info(lp + 'Inserting doc into touchdb, doc w/ id - ' + doc.oid + ', class_name - ' + doc.class_name + ', db url - ' + dbUrl + ', saving - ' + JSON.stringify(jDoc));

    db.insert(jDoc, doc.oid, function(err, body) {
      if (err) {
        logger.error(lp + 'Error inserting doc into touchdb, err - ' + err + ', doc w/ id - ' + doc.oid + ', class_name - ' + doc.class_name + ', body - ' + body);
        callback(err, body);
      }
      else {
        logger.info(lp + 'Inserted doc into touchdb, doc w/ id - ' + doc.oid + ', class_name - ' + doc.class_name + ', body - ' + util.inspect(body) + ', callback - ' + util.inspect(callback));
        doc._rev = body.rev;
        callback(undefined, doc);
      }
    });
  };

  var _toCouch = function(doc) {
    var out = doc.toJSON();

    out._rev = doc._rev;
    return out;
  }

  //
  // _delete: Delete doc from touch/couchdb.
  //
  var _delete = function(doc, callback) {};

  if (className) {
    return {
      create: create,
      read: read
    };
  }
  else {
    return {
      read: read
    };
  }

};

//
// Create the module via function invocation and passing a DB config.
//
module.exports = function(config) {

  var docs = {
    undefined: Object.create(docPrototype(undefined, config)),
    "plm.StorageRef": Object.create(docPrototype("plm.StorageRef", config)),
    "plm.InkImporter": Object.create(docPrototype("plm.InkImporter", config)),
    "plm.Image": Object.create(docPrototype("plm.Image", config))
  };

  return {
    docFactory: function(className, attr, callback) {
      if (_.has(docs, className)) {
        docs[className].create(attr, callback);
      }
      return undefined;
    },
    read: function(id, callback) {
      docs[undefined].read(id, callback);
    }
    //    update: function(id, attr, callback) {}
    //    del: function(id, callback) {}
  };

};
