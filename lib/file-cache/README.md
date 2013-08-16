# MediaManagerStorage/lib/file-cache

Cache of user files which are accessed by the application and cannot be packaged with the application in the assets directory. For example, images stored as attachments in TouchDB can be cached  in order to reduce load on TouchDB and allow the application to simply access the assets off of the local filesystem.

## Usage

The must be invoked as a function which is a factory method:

```

  var fileCache = require('MediaManagerStorage/lib/file-cache)({
    alias: '/mm-file-cache'
  });
  
  fileCache.putFromUrl(
    'http://localhost:59840/plm-media-manager-marek-jetson/506e23ec-47ee-462c-8574-bc354f7bc910/full-small.jpg',
    '506e23ec-47ee-462c-8574-bc354f7bc910',
    {name: 'web-gallery-large.jpg'},
    function() {
      console.log('Uploaded…')
    });
  
```

The module is a Singleton, hence the first time it is required any necessary options must be provided. Subsequently a require of the module can leave out any factory method options, and the singleton instance will be returned. Optionally, a *<b>singleton</b>* option may be passed in and set to false to return a new instance upon each require / invokation, which can be useful for testing.

## Module Factory Method, function(options)

### Overview

The module <b>MUST</b> be invoked as a function, and not as a constructor with the new method. The actory method, by default returns a singleton instance of the cache interface. It has the following basic signature:

```
    function(options)
```

### Options

  * alias: When requesting an asset with the *<b>get</b>* method, and a full path to the resource is desired, an alias can be substituted for the *<b>rootDir</b>* of the file cache portion of the path to the asset in the cache. For example, the application bundle may have an assets directory, with a link of the following form:

    ./assets/mm-file-cache -> /Users/chad/Library/Caches/media-manager/file

The alias option could be set to '/mm-file-cache' in order to access cached files from within the assets folder of the AppJS framework / chromium client. In this example the *<b>get</b>* method would return the following path:

    /mm-file-cache/zs/vs/506e23ec-47ee-462c-8574-bc354f7bc910/full-small.jpg

  * singleton: Default true. Set to false to return a new interface every time. Useful for testing, etc..

## Public Attributes

  * *<b>rootDir</b>*: The root directory of the file cache. Constructed as ` osxFs.cachesDir + '/media-manager/file'`, for example: `/Users/chad/Library/Caches/com.jetsonsystems.plm/media-manager/file`.

## Public Methods

  * *<b>getPath(name, id, options)</b>*: In the event of a cache hit, return a full or relative path to the file asset identified by name, associated with object w/ id. In the event of a cache miss *<b>null</b>* is returned. <br><br> Args:
    * *<b>name</b>*: Name (filename) of the asset.
    * *<b>id</b>*: Id of the object the asset is associated with.
    * *<b>options</b>*:
      * *<b>type</b>*: 'full' or 'reldative'. Defauilt is 'full'.
      * *<b>noCheck</b>*: If true, the path is returned regardless of whether we have a cache hit or miss. The default is false.<br><br>

  * *<b>putFromUrl(url, id, options, callback)</b>*: Load the file asset (store in our cache) as referenced via a network URL into the cache. The asset is associated with an object referenced by *<b>id</b>*. The name of the asset is derived from the network *<b>url</b>*. If the URL does NOT contain a filename component, a *<b>name</b>* attribute can be supplied in the options hash. If its a hit, any existing file will be overwritten. <br><br>Args:
    * url: Network URL to the asset.
    * id: id of object the asset is associated with.
    * options:
      * *<b>name</b>*: Name to assign the asset, which would subsequently be supplied to the *<b>get</b>* method.
      * *<b>type</b>*: As defined for *<b>getPath</b>*. Used to compute the *<b>path</b>* passed to the *<b>callback</b>*.
    * callback(err, path)<br><br>

  * *<b>putFromPath(path, id, options, callback)</b>*: Load the file asset (store in our cache) as referenced via a path to the local filesystem. <br><br>Args:
    * options:
      * *<b>name</b>*: Name to assign the asset, which would subsequently be supplied to the *<b>get</b>* method.
      


