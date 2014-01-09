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
    this.filename     = '';
    this.mimetype   = '';
    this.filesize = '';
    this.url = '';

    if (_.isObject(args)) {

      if (!_.isString(args.batch_id)) { delete args.batch_id;}

      for (var key in args) {
        this[key] = args[key];
      }

    }
  },

  // returns a sanitized cloned instance without extraneous fields,
  // suitable for saving or encoding into json
  toJSON : function() {
    var out = Object.clone(this);
    // these two are added by mootools
    delete out.$caller;
    delete out.caller;

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
