//
// MediaManagerStorage/lib/gdrive: Storage to Google Drive.
//
//  Classes:
//
//    Uploader
//
//      Constructor:
//
//        Uploader(q, account, options): Instantiates an uploader instances. It is an event emitter. See Events.
//
//      Methods:
//
//        start
//        stop
//      
//      Events:
//
//    Methods:
//
//      upload
//      download
//

module.exports = function gdriveModule() {

  var Uploader = function(q, account, options) {

  };

  var upload = function() {};

  var download = function() {};

  return {
    Uploader: Uploader,
    upload: upload,
    download: download
  };

}();
