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
