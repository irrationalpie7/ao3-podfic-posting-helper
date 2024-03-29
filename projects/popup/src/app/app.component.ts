import {AsyncPipe} from '@angular/common';
import {Component, ViewChild, inject, signal} from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import {MatButton, MatIconAnchor} from '@angular/material/button';
import {MatCheckbox} from '@angular/material/checkbox';
import {MatError, MatFormField, MatLabel} from '@angular/material/form-field';
import {MatIcon} from '@angular/material/icon';
import {MatInput} from '@angular/material/input';
import {MatToolbar, MatToolbarRow} from '@angular/material/toolbar';
import {MatOption, MatSelect} from '@angular/material/select';
import {MatSnackBar, MatSnackBarModule} from '@angular/material/snack-bar';
import {ANALYTICS} from 'common';
import {MatChipListbox, MatChipOption} from '@angular/material/chips';
import {INITIAL_FORM_VALUES} from '../utils';
import {injectImportAndFillMetadata} from './inject';
import {MatProgressSpinner} from '@angular/material/progress-spinner';
import {from} from 'rxjs';
import {map, tap, take} from 'rxjs/operators';

const AUDIO_FORMAT_TAG_PREFIX = 'audio-format-tag-';

const ALLOWED_URL_PATTERNS: Array<RegExp | string> = [
  // Standard new work
  'https://archiveofourown.org/works/new',
  // New work added to a collection
  /https:\/\/archiveofourown.org\/collections\/(.*)\/works\/new/,
  // Editing an existing work
  /https:\/\/archiveofourown.org\/works\/[0-9]+\/edit/,
];

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    AsyncPipe,
    MatButton,
    MatCheckbox,
    MatChipListbox,
    MatChipOption,
    MatError,
    MatFormField,
    MatIcon,
    MatIconAnchor,
    MatInput,
    MatLabel,
    MatOption,
    MatProgressSpinner,
    MatSelect,
    MatSnackBarModule,
    MatToolbar,
    MatToolbarRow,
    ReactiveFormsModule,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  private readonly initialFormValues = inject(INITIAL_FORM_VALUES);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly optionsPageUrl =
    chrome.runtime.getURL('options/index.html');

  protected readonly onAo3NewWorkPage = from(
    chrome.tabs.query({
      active: true,
      currentWindow: true,
    }),
  ).pipe(
    take(1),
    map(([currentTab]) => {
      const currentTabUrl = currentTab.url || '';
      return ALLOWED_URL_PATTERNS.some(
        allowedUrlPattern => currentTabUrl.match(allowedUrlPattern) !== null,
      );
    }),
    tap(onAo3NewWorkPage => {
      if (onAo3NewWorkPage) {
        ANALYTICS.firePageViewEvent('Form');
      } else {
        ANALYTICS.firePageViewEvent('Not on new work URL page');
      }
    }),
  );

  protected readonly podficLengthOptions: readonly string[] = [
    '0-10 Minutes',
    '10-20 Minutes',
    '20-30 Minutes',
    '30-45 Minutes',
    '45-60 Minutes',
    '1-1.5 Hours',
    '1.5-2 Hours',
    '2-2.5 Hours',
    '2.5-3 Hours',
    '3-3.5 Hours',
    '3.5-4 Hours',
    '4-4.5 Hours',
    '4.5-5 Hours',
    '5-6 Hours',
    '6-7 Hours',
    '7-10 Hours',
    '10-15 Hours',
    '15-20 Hours',
    'Over 20 Hours',
  ];

  protected readonly podficFormatTagOptions: readonly string[] = [
    'MP3',
    'M4A',
    'M4B',
    'Streaming',
    'Download',
  ];

  protected readonly initialAudioFormatTagValues: ReadonlySet<string> =
    new Set<string>(
      this.initialFormValues.audioFormatTagOptionIds.map(id =>
        id.replace(AUDIO_FORMAT_TAG_PREFIX, ''),
      ),
    );

  protected readonly formGroup = new FormGroup({
    url: new FormControl<string>(this.initialFormValues.url, {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.pattern('https://archiveofourown.org/(.*/)?works/[0-9]+.*'),
      ],
    }),
    podficLabel: new FormControl<boolean>(this.initialFormValues.podficLabel, {
      nonNullable: true,
    }),
    podficLengthLabel: new FormControl<boolean>(
      this.initialFormValues.podficLengthLabel,
      {nonNullable: true},
    ),
    podficLength: new FormControl<string>(
      this.initialFormValues.podficLengthValue,
      {nonNullable: true},
    ),
    titleFormat: new FormControl<string>(this.initialFormValues.titleFormat, {
      nonNullable: true,
    }),
    summaryFormat: new FormControl<string>(
      this.initialFormValues.summaryFormat,
      {nonNullable: true},
    ),
  });

  protected readonly loading = signal<boolean>(false);

  @ViewChild(MatChipListbox)
  audioFormatTagListbox!: MatChipListbox;

  protected async fillNewWorkForm(): Promise<void> {
    if (this.formGroup.invalid) {
      return;
    }

    this.loading.set(true);

    const selectedListOptions = Array.isArray(
      this.audioFormatTagListbox.selected,
    )
      ? this.audioFormatTagListbox.selected
      : [this.audioFormatTagListbox.selected];

    const audioFormatTagOptionIds: readonly string[] = selectedListOptions
      .map(option => option.value)
      .map(value => `${AUDIO_FORMAT_TAG_PREFIX}${value}`);

    const {
      url,
      podficLabel,
      podficLengthLabel,
      podficLength,
      titleFormat,
      summaryFormat,
    } = this.formGroup.value;
    // Save the options, because we won't be able to access them in the injected
    // script.
    await chrome.storage.sync.set({
      options: {
        url: url?.trim(),
        podfic_label: podficLabel,
        podfic_length_label: podficLengthLabel,
        podfic_length_value: podficLength,
        title_format: titleFormat,
        summary_format: summaryFormat,
        audioFormatTagOptionIds,
      },
    });

    const {workbody, title_template, summary_template, notes_template} =
      await chrome.storage.sync.get([
        'workbody',
        'title_template',
        'summary_template',
        'notes_template',
      ]);

    ANALYTICS.fireEvent('popup_form_submit', {
      podfic_label: String(podficLabel),
      podfic_length_value: podficLength,
      title_format: titleFormat,
      summary_format: summaryFormat,
      audio_formats: audioFormatTagOptionIds.join(','),
    });

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    let result: {result: string; message?: string} | undefined;
    try {
      const injectedScriptResults = await chrome.scripting.executeScript({
        target: {tabId: tab.id!},
        func: injectImportAndFillMetadata,
        args: [
          {
            url: url!, // Fix: Assign the url value to the url property
            podficLabel: podficLabel!,
            podficLengthLabel: podficLengthLabel!,
            podficLengthValue: podficLength!,
            titleFormat: titleFormat!,
            summaryFormat: summaryFormat!,
            audioFormatTagOptionIds,
            workTemplate: workbody['default'],
            userSummaryTemplate: summary_template['default'],
            userTitleTemplate: title_template['default'],
            userNotesTemplate: notes_template['default'],
            beginNotes: notes_template['begin'],
            endNotes: notes_template['end'],
          },
        ],
      });
      // We only have one target so there is only one result.
      result = injectedScriptResults[0].result;
    } catch (e: unknown) {
      if (e instanceof Error) {
        result = {result: 'error', message: `${e.message}: ${e.stack}`};
      } else {
        result = {result: 'error', message: `{${e}}`};
      }
    }

    if (result?.result === 'error') {
      this.formGroup.controls.url.setErrors({
        injectedScriptError: result?.message,
      });
      ANALYTICS.fireErrorEvent(result?.message || '');
      this.snackBar.open('Failed to import metadata');
    } else {
      this.snackBar.open('Import finished');
    }

    this.loading.set(false);
  }
}
