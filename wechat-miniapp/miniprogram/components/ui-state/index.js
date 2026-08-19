'use strict';
/* global Component */

Component({
  properties: {
    mode: { type: String, value: 'loading' },
    title: { type: String, value: '' },
    detail: { type: String, value: '' },
    actionText: { type: String, value: '' },
    compact: { type: Boolean, value: false },
  },
  methods: {
    onAction() { this.triggerEvent('action'); },
  },
});
