var _ = require('underscore');
require('mootools');
var Persistent = require('../plm-persistent');

module.exports = new Class({
  Extends: Persistent,

  initialize : function(args)
  {
    this.parent(args);
    this.class_name = 'plm.StorageRef'; 

    this.doc_class_name = undefined;
    this.doc_id  = undefined;
    this.desc = undefined;
    this.state = {
      status: undefined,
      store_started_at: undefined,
      store_completed_at: undefined
    };

    //
    // Datastore specific meta-data to reference the document or asset.
    //
    ref: {};
    
    if (_.isObject(args)) {
      for (var key in args) {
        this[key] = args[key];
      }
    }
  },

  //
  // JSON representation:
  //
  toJSON : function() {
    var out = Object.clone(this);
    // these two are added by mootools
    delete out.$caller;
    delete out.caller;

    // cloning will cause functions to be saved to couch if we don't remove them
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
