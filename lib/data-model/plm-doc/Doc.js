'use strict';
var _ = require('underscore');
require('mootools');
var Persistent = require('../plm-persistent');

module.exports = new Class(
{
  Extends: Persistent,

  initialize : function(args)
  {
    this.parent(args);
    this.class_name = 'plm.Doc'; 

    this.batch_id = '';
    this.filename = '';
    this.mimetype = '';
    this.filesize = '';
    this.url = '';
    this.variants = [];

    if (_.isObject(args)) {

      if (!_.isString(args.batch_id)) { delete args.batch_id;}

      for (var key in args) {
        this[key] = args[key];
      }

    }
  },

  isVariant: function isVariant() {
    return  _.isString(this.orig_id) && this.orig_id !== '' ;
  },

  isOriginal: function isOriginal() {
      return !this.isVariant();
  },

  // returns a sanitized cloned instance without extraneous fields,
  // suitable for saving or encoding into json
  toJSON : function() {
    var out = Object.clone(this);
    // these two are added by mootools
    delete out.$caller;
    delete out.caller;
    // do not stringify variants, these have to be stringified individually via this.variants;
    // also, variants are not stored in couch with the original doc
    delete out.variants;

    var storage = this._storage;
    for (var prop in out) {
      if ( prop.indexOf("_") === 0 || _.isFunction(out[prop]) ) {
        delete out[prop];
      }
    }
    if (_.has(storage, 'rev')) {
      out._rev = storage.rev;
    }
    return out;
  }

}); 
