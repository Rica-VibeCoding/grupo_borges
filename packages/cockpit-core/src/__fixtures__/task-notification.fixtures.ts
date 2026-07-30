export const failedTaskNotificationXml = [
  '<task-notification>',
  '<task-id>bzubuuj01</task-id>',
  '<tool-use-id>toolu_01failed</tool-use-id>',
  '<output-file>/tmp/bzubuuj01/output</output-file>',
  '<status>failed</status>',
  '<summary>Background command \'pnpm test\' failed with exit code 144</summary>',
  '</task-notification>',
].join('\n');

export const doneTaskNotificationXml = [
  '<task-notification>',
  '<task-id>done12345</task-id>',
  '<tool-use-id>toolu_01done</tool-use-id>',
  '<output-file>/tmp/done12345/output</output-file>',
  '<status>done</status>',
  '<summary>Background command completed successfully</summary>',
  '</task-notification>',
].join('\n');

export const monitorTaskNotificationXml = [
  '<task-notification>',
  '<task-id>bvhvvwlz8</task-id>',
  '<summary>Monitor event: "Tara bmac929z9 — eventos-chave (v2)"</summary>',
  '<event>REPORT_READY: /tmp/tara-ios-form-bar.md (5882 bytes)</event>',
  "If this event is something the user would act on now, send a PushNotification. Routine or benign output doesn't need one.",
  '</task-notification>',
].join('\n');
