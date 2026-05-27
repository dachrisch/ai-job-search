class JobPipeline:
    def process_item(self, item, spider):
        # Validate that title and company exist
        if not item.get('title') or not item.get('company'):
            raise DropItem(f"Missing title or company in {item}")

        # Normalize whitespace in all fields
        for field in item.fields:
            if isinstance(item[field], str):
                item[field] = ' '.join(item[field].split())

        return item
