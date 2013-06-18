# MediaManagerStorage/lib/data-model
This module contains a collection of sub-modules for the various flavors of documents which are utilized by PLM.

Each document is identified by a *<b>class_name</b>* attribute. To construct a new document in memory simply invoke the factory method as follows:

    var dataModel = require('./lib/data-model');
    
    dataModel.docFactory(<class name>. <attributes>);

For example, to create a new *image* document:

    var image = dataModel.docFactory('plm.Image');
    
## Base Classes

  * [Persistent](./plm-persistent/README.md): Base class for common attributes to persistent in all documents.

## Flavors of Documents

The following flavors of documents exist:

  * [plm.Image](./plm-image/README.md): Represents an image and its meta-data.
  * [plm.ImportBatch](./plm-image/README.md): Represents a batch of images which have/are or have been imported.
  * [plm.StorageRef](./plm-storage-ref/README.md): Represents a reference to a document in some datastore. For example, an image's meta data is stored in an [plm.Image](./data-model/plm-image/README.md) document, however the concrete asset associated with the image may be stored in another data store.
