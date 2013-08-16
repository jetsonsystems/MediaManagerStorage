# MediaManagerStorage

Provides interfaces to supported data stores.

## Usage

By default, loading [MediaManagerStorage](https://github.com/jetsonsystems/MediaManager/blob/master/MediaManagerStorage/README.md) and invoking *<b>get()</b>* returns an instance of [MediaManagerStorage/lib/touchdb](https://github.com/jetsonsystems/MediaManager/blob/master/MediaManagerStorage/lib/touchdb/README.md). For example:

    var config = requre('MediaManagerAppConfig');
    var touchdb = require('MediaManagerStorage')(config.db).get();

The module is a Singleton, hence the first time it is required with a config, that is what will be used. Subsequently requiring of the module can leave out a config, and the singleton is returned.

Supported storage sub-modules for TouchDB and Google Drive can also be explicitly requested:

    var touchdb = require('MediaManagerStorage').get('touchdb')

or

    var gdrive = require('MediaManagerStorage').get('gdrive')

In addition in memory documents can be create utilizing the *<b>docFactory</b>* method of the module.
    
## Methods

  * *<b>get(\<storage sub module\>,[\<options\>])</b>*: Load a storage \<sub module\>. Storage submodules may be:

    * touchdb: Loads the [MediaManagerStorage/lib/touchdb](https://github.com/jetsonsystems/MediaManager/blob/master/MediaManagerStorage/lib/touchdb/README.md) module.
    * file-cache: Loads the [MediaManagerStorage/lib/file-cache](https://github.com/jetsonsystems/MediaManager/blob/master/MediaManagerStorage/lib/file-cache/README.md) module.
    * gdrive: Loads the [MediaManagerStorage/lib/gdrive](https://github.com/jetsonsystems/MediaManager/blob/master/MediaManagerStorage/lib/gdrive/README.md) module.

  * *<b>docFactory(\<class_name attribute\>)</b>*: Creates in memory JSON representations of documents which are NOT tied to a particular storage engine. See: [Data Model](https://github.com/jetsonsystems/MediaManager/blob/master/MediaManagerStorage/lib/data-model/README.md).
    
## Data Model
The [Data Model](https://github.com/jetsonsystems/MediaManager/blob/master/MediaManagerStorage/lib/data-model/README.md) module provides us with an interface to a *<b>docFactory</b>* method to create in memory JSON representations of documents which may possibly be stored. The [MediaManagerStorage](https://github.com/jetsonsystems/MediaManager/blob/master/MediaManagerStorage/README.md) module provides a proxy to this factory method.

## touchdb / couchdb

Documents which we intend to sync accross multiple instances of PLM are stored in TouchDB locally on the Desktop and remotely in CouchDB. See [MediaManagerStorage/lib/touchdb/README](https://github.com/jetsonsystems/MediaManager/blob/master/MediaManagerStorage/lib/touchdb/README.md) for more details.

## file-cache

Cache of user files which are accessed by the application and cannot be packaged with the application in the assets directory. For example, images stored as attachments in TouchDB can be cached in order to reduce load on TouchDB and allow the application to simply access the assets off of the local filesystem. See [MediaManagerStorage/lib/file-cache/README](https://github.com/jetsonsystems/MediaManager/blob/master/MediaManagerStorage/lib/file-cache/README.md) for more details.

## gdrive
An interface is provided to store documents or assets on Google Drive. See [MediaManagerStorage/lib/gdrive/README](https://github.com/jetsonsystems/MediaManager/blob/master/MediaManagerStorage/lib/gdrive/README.md)

