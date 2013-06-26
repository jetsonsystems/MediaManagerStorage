//
// MediaManagerStorage/lib/touchdb/docs.js: Decorates a document with REST methods to interact with touchdb / couchdb.
//

var _ = require('underscore');

var dataModel = require('../data-model');

//
// docPrototype: Defines index, create, read, update and delete
//  methods. There are two flavors of methods, those that operate
//  on collections, and those that operate on instances of a 
//  particular document.
//
//  Collection methods:
//    index = function(query, callback) {};
//    create = function(attr, callback)  {};
//    read = function(id, callback) {};
//    update = function(id, attr, callback) {};
//    delete = function(id, callback) {};
//
//  Instance methods:
//
//    read = function(callback) {};
//    update = function(attr, callback) {};
//    delete = function(callback) {};
//
//  read, update, and delete are overloaded. When an id is passed,
//  a _findById(id) is invoked to get a copy of the document,
//  and in the case of:
//    read - the document is returned.
//    update - _update(attr) and _save are performed.
//    delete - _delete is performed.
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

var docPrototype = function(className) {

  //
  // _save: Persist doc to touch/couchdb.
  //
  var _save = function(doc, callback) {
    callback(undefined, doc);
  };

  //
  // _delete: Delete doc from touch/couchdb.
  //
  var _delete = function(doc, callback) {};

  var doc = undefined;

  var index = function(query, callback) {
    _index(query, callback);
  };

  var create = function(attr, callback)  {
    doc = dataModel.docFactory(className, attr);
    _save(doc, function(error, doc) {
      if (error) {
        doc = undefined;
        callback(error);
      }
      else {
        callback(undefined, doc);
      }
    });
  };

  var read = function(id, callback) {
    if (typeof(id) === 'string') {
    }
    else {
    }
  };

  var update = function(id, attr, callback) {
    if (typeof(id) === 'string') {
    }
    else {
    }
  };

  var del = function(id, callback) {
    if (typeof(id) === 'string') {
      doc = _findById(id, function(error, doc) {
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

  return {
    create: create
  };

};

var docs = {
  "plm.StorageRef": Object.create(docPrototype("plm.StorageRef"))
};

module.exports = {

  docFactory: function(className, attr, callback) {
    if (_.has(docs, className)) {
      docs[className].create(attr, callback);
    }
    return undefined;
  }

};
