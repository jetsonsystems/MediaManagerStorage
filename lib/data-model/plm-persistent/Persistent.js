'use strict';
var _ = require('underscore');
require('mootools');


// Persistent is a parent class/interface for persistent objects;
// -------------------------------------------------------------
module.exports = new Class (
{
  /* Implements: [process.EventEmitter], */

  initialize : function(args)
  {
    this.class_name = 'plm.Persistent'; // override in extending class

    if (_.isObject(args)) { 
         
      // a unique object/instance id
      if (_.isString(args.oid)) { this.oid = args.oid;}

      // app.id of application creating or modifying the document.
      if (_.isString(args.app_id)) { this.app_id = args.app_id;}

      // a revision id for this instance
      // if (_.isString(args.rev)) { this.rev = args.rev;}
    }

    if (_.isObject(args) && _.isDate(args.created_at)) { 
      this.created_at = args.created_at;
    } else {
      this.created_at = new Date();
    }

    if (_.isObject(args) && _.isDate(args.updated_at)) { 
      this.updated_at = args.updated_at;
    } else {
      this.updated_at = this.created_at;
    }

    // a field intended to be private that stores storage-specific metadata
    this._storage  = {};


    if (_.isObject(args) && (args.in_trash)) {
      this.in_trash = true;
    }

  },

  // move this method to a makePersistent method
  sendToTrash : function(){
    this.in_trash = true;
  },

  restoreFromTrash : function(){
    this.in_trash = false;
  },

  inTrash : function(){
    return this.in_trash === true;
  }

});
