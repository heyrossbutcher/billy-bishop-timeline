import { defineField, defineType } from 'sanity';

export default defineType({
  name: 'event',
  title: 'Timeline Event',
  type: 'document',
  fields: [
    defineField({
      name: 'year',
      title: 'Year',
      type: 'number',
      validation: Rule => Rule.required().integer().min(1900).max(2100),
    }),
    defineField({
      name: 'title',
      title: 'Title',
      type: 'string',
      validation: Rule => Rule.required(),
    }),
    defineField({
      name: 'description',
      title: 'Description',
      type: 'text',
      rows: 3,
      validation: Rule => Rule.required(),
    }),
    defineField({
      name: 'month',
      title: 'Month / Date',
      type: 'string',
    }),
    defineField({
      name: 'source',
      title: 'Source',
      type: 'string',
    }),
    defineField({
      name: 'sourceUrl',
      title: 'Source URL',
      type: 'url',
    }),
    defineField({
      name: 'status',
      title: 'Status',
      type: 'string',
      options: {
        list: [
          { title: 'Good', value: 'good' },
          { title: 'Worrisome', value: 'worrisome' },
          { title: 'Bad', value: 'bad' },
        ],
        layout: 'radio',
      },
    }),
  ],
  orderings: [
    {
      title: 'Year (oldest first)',
      name: 'yearAsc',
      by: [{ field: 'year', direction: 'asc' }],
    },
  ],
  preview: {
    select: { title: 'title', subtitle: 'year', status: 'status' },
    prepare({ title, subtitle, status }) {
      const indicator = status === 'good' ? '🟢' : status === 'worrisome' ? '🟡' : status === 'bad' ? '🔴' : '';
      return { title: `${indicator} ${title}`, subtitle: String(subtitle) };
    },
  },
});
