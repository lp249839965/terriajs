'use strict';

/*global require*/

var defined = require('../../third_party/cesium/Source/Core/defined');
var defineProperties = require('../../third_party/cesium/Source/Core/defineProperties');
var DeveloperError = require('../../third_party/cesium/Source/Core/DeveloperError');
var EventHelper = require('../../third_party/cesium/Source/Core/EventHelper');
var knockout = require('../../third_party/cesium/Source/ThirdParty/knockout');

/**
 * The view-model for the "Now Viewing" pane.
 */
var NowViewingViewModel = function(context) {
    this._context = context;
    this._eventSubscriptions = new EventHelper();

    /**
     * Gets the list of items that we are "now viewing".  It is recommended that you use
     * the methods on this instance instead of manipulating the list of items directly.
     * This property is observable.
     * @type {GeoDataMemberViewModel[]}
     */
    this.items = [];

    /**
     * Gets or sets a value indicating whether the Now Viewing list is currently open and visible.
     * @type {Boolean}
     */
    this.isOpen = true;

    knockout.track(this, ['items', 'isOpen']);

    this._eventSubscriptions.add(this.context.beforeViewerChanged, function() {
        beforeViewerChanged(this);
    }, this);

    this._eventSubscriptions.add(this.context.afterViewerChanged, function() {
        afterViewerChanged(this);
    }, this);
};

defineProperties(NowViewingViewModel.prototype, {
    /**
     * Gets the context for this Now Viewing list.
     * @memberOf NowViewingViewModel.prototype
     * @type {GeoDataCatalogContext}
     */
    context : {
        get : function() {
            return this._context;
        }
    },

    /**
     * Gets a value indicating whether the "Now Viewing" pane has one or more items.
     * @memberOf NowViewingViewModel.prototype
     * @type {Boolean}
     */
    hasItems : {
        get : function() {
            return this.items.length > 0;
        }
    },

    /**
     * Gets a value indicating whether the "Now Viewing" pane has at list own data
     * source that is currently shown.
     * @memberOf NowViewingViewModel.prototype
     * @type {Boolean}
     */
    hasShownItems : {
        get : function() {
            for (var i = 0; i < this.items.length; ++i) {
                if (this.items[i].isShown) {
                    return true;
                }
            }
            return false;
        }
    }
});

/**
 * Destroys this instance, including unsubscribing it from any events.
 */
NowViewingViewModel.prototype.destroy = function() {
    this._eventSubscriptions.removeAll();
};

/**
 * Adds an item to the "Now Viewing" pane.
 *
 * @param {GeoDataMemberViewModel} item The item to add.
 */
NowViewingViewModel.prototype.add = function(item) {
    // Keep reorderable data sources (ie: imagery layers) below non-orderable ones (ie: GeoJSON).
    if (item.supportsReordering) {
        var index = 0;

        while (index < this.items.length && !this.items[index].supportsReordering) {
            ++index;
        }

        this.items.splice(index, 0, item);
    } else {
        this.items.unshift(item);
    }
};

/**
 * Removes an item from the "Now Viewing" pane and from the map.
 *
 * @param {GeoDataMemberViewModel} item The item to remove.
 */
NowViewingViewModel.prototype.remove = function(item) {
    item.isEnabled = false;
    this.items.remove(item);
};

/**
 * Removes all data sources from the "Now Viewing" pane and from the map.
 */
NowViewingViewModel.prototype.removeAll = function() {
    // Work backwards through the list of items because setting isEnabled=false
    // will usually remove the item from the list.
    for (var i = this.items.length - 1; i >= 0; --i) {
        this.items[i].isEnabled = false;
    }

    this.items.removeAll();
};

/**
 * Raises an item, making it displayed on top of the item that is currently above it.  If it
 * is nonsensical to move this item up (e.g. it is already at the top), this method does nothing.
 *
 * @param {GeoDataMemberViewModel} item The item to raise.
 * @param {Number} [index] The index of the item of the list, if it is already known.
 */
NowViewingViewModel.prototype.raise = function(item, index) {
    if (defined(index)) {
        if (this.items[index] !== item) {
            throw new DeveloperError('The provided index is not correct.');
        }
    } else {
        index = this.items.indexOf(item);
        if (index < 0) {
            return;
        }
    }

    if (index === 0) {
        return;
    }

    // Don't allow reorderable data sources to move above non-reorderable ones.
    if (item.supportsReordering && !this.items[index - 1].supportsReordering) {
        return;
    }

    var context = this.context;

    if (defined(context.cesiumScene)) {
        raiseInCesium(this, item, this.items[index - 1]);
    }

    if (defined(context.leafletMap)) {
        raiseInLeaflet(this, item, this.items[index - 1]);
    }

    this.items.splice(index, 1);
    this.items.splice(index - 1, 0, item);
};

/**
 * Lowers an item, making it displayed below the item that is currently below it.  If it
 * is nonsensical to move this item down (e.g. it is already at the bottom), this method does nothing.
 *
 * @param {GeoDataMemberViewModel} item The item to lower.
 * @param {Number} [index] The index of the item of the list, if it is already known.
 */
NowViewingViewModel.prototype.lower = function(item, index) {
    if (defined(index)) {
        if (this.items[index] !== item) {
            throw new DeveloperError('The provided index is not correct.');
        }
    } else {
        index = this.items.indexOf(item);
        if (index < 0) {
            return;
        }
    }

    if (index === this.items.length - 1) {
        return;
    }

    var itemBelow = this.items[index + 1];

    // Don't allow non-reorderable data sources to move below reorderable ones.
    if (!item.supportsReordering && itemBelow.supportsReordering) {
        return;
    }

    var context = this.context;

    if (defined(context.cesiumScene)) {
        lowerInCesium(this, item, itemBelow);
    }

    if (defined(context.leafletMap)) {
        lowerInLeaflet(this, item, itemBelow);
    }

    this.items.splice(index, 1);
    this.items.splice(index + 1, 0, item);
};

/**
 * Toggles the {@link NowViewingViewModel#isOpen} flag.  If it's open, it is closed.  If it's closed, it is opened.
 */
NowViewingViewModel.prototype.toggleOpen = function() {
    this.isOpen = !this.isOpen;
};

/**
 * Records the the index of each data source in the Now Viewing list in a {@link GeoDataItemViewModel#nowViewingIndex} property
 * on the data source.  This is used to save the state of the Now Viewing list and is not intended for general
 * use.
 * @private
 */
NowViewingViewModel.prototype.recordNowViewingIndices = function() {
    for (var i = 0; i < this.items.length; ++i) {
        this.items[i].nowViewingIndex = i;
    }
};

/**
 * Sorts the data sources in the Now Viewing list by their {@link GeoDataItemViewModel#nowViewingIndex} properties.  This is used
 * to restore the state of the Now Viewing list and is not intended for general use.
 * @private
 */
NowViewingViewModel.prototype.sortByNowViewingIndices = function() {
    var sortedItems = this.items.slice();
    sortedItems.sort(function(a, b) {
        return a.nowViewingIndex - b.nowViewingIndex;
    });

    for (var i = 0; i < sortedItems.length; ++i) {
        var item = sortedItems[i];

        var existingIndex = this.items.indexOf(item);

        while (existingIndex > i) {
            this.raise(item, existingIndex);
            --existingIndex;
        }
    }
};

// Raise and lower functions for the two maps.  Currently we can only raise and lower imagery layers.

function raiseInCesium(viewModel, item, itemAbove) {
    if (!defined(item.imageryLayer) || !defined(itemAbove.imageryLayer)) {
        return;
    }

    var scene = viewModel.context.cesiumScene;
    scene.imageryLayers.raise(item.imageryLayer);
}

function lowerInCesium(viewModel, item, itemBelow) {
    if (!defined(item.imageryLayer) || !defined(itemBelow.imageryLayer)) {
        return;
    }

    var scene = viewModel.context.cesiumScene;
    scene.imageryLayers.lower(item.imageryLayer);
}

function raiseInLeaflet(viewModel, item, itemAbove) {
    swapLeafletZIndices(viewModel, item, itemAbove);
}

function lowerInLeaflet(viewModel, item, itemBelow) {
    swapLeafletZIndices(viewModel, item, itemBelow);
}

function swapLeafletZIndices(viewModel, item, otherItem) {
    if (!defined(item.imageryLayer) || !defined(otherItem.imageryLayer)) {
        return;
    }

    var map = viewModel.context.leafletMap;

    if (!defined(item.imageryLayer.options.zIndex) || !defined(item.imageryLayer.options.zIndex)) {
        // Set the current z-index of all layers.
        var items = viewModel.items;
        var zIndex = 100; // an arbitrary place to start
        for (var i = items.length - 1; i >= 0; --i) {
            var currentItem = items[i];
            if (currentItem.supportsReordering && defined(currentItem.imageryLayer)) {
                currentItem.imageryLayer.setZIndex(zIndex++);
            }
        }
    }

    // Swap the z-indices of the two layers.
    var itemIndex = item.imageryLayer.options.zIndex;
    var otherIndex = otherItem.imageryLayer.options.zIndex;

    item.imageryLayer.setZIndex(otherIndex);
    otherItem.imageryLayer.setZIndex(itemIndex);
}

function beforeViewerChanged(viewModel) {
    // Hide and disable all data sources, without actually changing
    // their isEnabled and isShown flags.

    var context = viewModel.context;
    var dataSources = viewModel.items;

    for (var i = 0; i < dataSources.length; ++i) {
        var dataSource = dataSources[i];

        if (dataSource.isShown) {
            if (defined(context.cesiumScene)) {
                dataSource._hideInCesium();
            }

            if (defined(context.leafletMap)) {
                dataSource._hideInLeaflet();
            }
        }

        if (dataSource.isEnabled) {
            if (defined(context.cesiumScene)) {
                dataSource._disableInCesium();
            }

            if (defined(context.leafletMap)) {
                dataSource._disableInLeaflet();
            }
        }
    }
}

function afterViewerChanged(viewModel) {
    // Re-enable and re-show all data sources that were previously enabled or shown.
    // Work from the bottom data source up so that the correct order is created.

    var context = viewModel.context;
    var dataSources = viewModel.items;

    for (var i = dataSources.length - 1; i >= 0; --i) {
        var dataSource = dataSources[i];

        if (dataSource.isEnabled) {
            if (defined(context.cesiumScene)) {
                dataSource._enableInCesium();
            }

            if (defined(context.leafletMap)) {
                dataSource._enableInLeaflet();
            }
        }

        if (dataSource.isShown) {
            if (defined(context.cesiumScene)) {
                dataSource._showInCesium();
            }

            if (defined(context.leafletMap)) {
                dataSource._showInLeaflet();
            }
        }
    }
}

module.exports = NowViewingViewModel;
