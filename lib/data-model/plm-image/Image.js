'use strict';
var _ = require('underscore');
require('mootools');
var Persistent = require('../plm-persistent');

// Image represents basic information on an image
// ----------------------------------------------
// exports.Image = new Class(
module.exports = new Class(
{
  Extends: Persistent,

  initialize : function(args)
  {
    this.parent(args);
    this.class_name = 'plm.Image'; 

    this.orig_id  = '';
    this.batch_id = '';
    this.path     = '';
    this.name     = '';
    this.format   = '';
    this.geometry = '';
    this.size     = {};
    this.filesize = '';
    this.checksum = '';
    this.variants = [];
    this.metadata_raw = {};
    this.tags = [];
    this.url = '';

    // by default, we suppress display of raw metadata in toJSON,
    // set this to true prior to calling toJSON to expose the metadata
    this.exposeRawMetadata = false;

    
    if (_.isObject(args)) {

      if (!_.isString(args.orig_id) ) { delete args.orig_id; }
      if (!_.isString(args.batch_id)) { delete args.batch_id;}

      for (var key in args) {
        this[key] = args[key];
      }

      if (!this.name && this.path) {
        this.name = this.extractNameFromPath(this.path);
      }
    }
  },

  isVariant: function isVariant() {
    return  _.isString(this.orig_id) && this.orig_id !== '' ;
  },

  isOriginal: function isOriginal() {
    return !this.isVariant();
  },

  /** 
   * class-level (static) utility method that retrieves a name attached to a path, assumes a unix
   * '/' path separator
   * TODO: enhance this so that it works on windows
   */
  extractNameFromPath: function extractNameFromPath(aPath) {
    var tokens = aPath.split("/");
    return tokens[tokens.length - 1];
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

    //TODO: output date/timestamps as: "2009/05/25 06:10:40 +0000" ?
    
    delete out.exposeRawMetadata;
    if (!this.exposeRawMetadata) { delete out.metadata_raw; }
    
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
  },

  // populate this Image object based on the output of GraphicsMagick.identify()
  readFromGraphicsMagick : function(obj)
  {
    if (_.isObject(obj)) {
      this.format   = obj.format;
      this.geometry = obj.Geometry;
      this.size     = obj.size;
      this.filesize = obj.Filesize;
      this.metadata_raw = obj;
    }
  },

  tagsGet : function(){
    return this.tags;
  },

  tagsAdd : function(tags,callback){

    if (_.isArray(tags))
    {

      //check that only strings are valid
      for(var i=0;i< tags.length;i++){
        var tag = tags[i];
        if(!(typeof tag =='string')){
          var err = 'Invalid array_of_tags: elements must be of type String';
          if(_.isFunction(callback)){
            callback(err);
          }
          return;

        }
        else{
          this.tags.push(tag);
        }
      }
    }else if (_.isString(tags)){
      this.tags.push(tags);
    }

    this.tags.sort();
    //remove duplicates
    //skip the sort step in _.uniq
    var alreadySorted=true;
    this.tags = _.uniq(this.tags,alreadySorted);
    if(_.isFunction(callback)){
      callback();
    }
  },

  /**
   *
   * @param tags can be a string or an array of strings
   * @param callback
   */
  tagsDelete : function(tags,callback){

    if (_.isArray(tags) || _.isString(tags)) {
      var tagsToDelete = [];
      tagsToDelete.push(tags);
      tagsToDelete = _.flatten(tagsToDelete);

      if (_.isArray(this.tags)) {
        var self = this;
        _.forEach(tagsToDelete, function (tagToDelete) {
          if (_.isString(tagToDelete)) {
            var index = self.tags.indexOf(tagToDelete);
            if (index >= 0) {
              self.tags.splice(index, 1);
            }
          }
        });
      }
    }

    if(_.isFunction(callback)){
      callback();
    }

  },

  /**
   * The tags in oldTags will be replaced by the tags in newTags
   * oldTags[1] will be replaced by newTags[1]
   * oldTags[2] will be replaced by newTags[2]
   *          .
   *          .
   * oldTags[n] will be replaced by newTags[n]
   *
   * @param oldTags
   * @param newTags
   * @param callback
   */
  tagsReplace : function(oldTags, newTags, callback){

    if(_.isArray(oldTags) && _.isArray(newTags) && (oldTags.length === newTags.length)){
      var len=oldTags.length;
      for(var i=0; i<len; i++) {
        var oldTag = oldTags[i];
        if(_.contains(this.tags,oldTag)){
          this.tagsDelete(oldTag);
          this.tagsAdd(newTags[i]);
        }
      }
    }

    if(_.isFunction(callback)){
      callback();
    }
  }

}); 

// var img = new Image();
// console.log('img: ' + JSON.stringify(img));
