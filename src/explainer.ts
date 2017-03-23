'use strict';

export default function formatExplain(rawText) {
    if (!rawText) {
        return rawText;
    }

    const lines = rawText.replace(/\r\n/g, '\n').split('\n');

    if (rawText.startsWith('FIELD')) {
        return formatField(lines);
    }

    if (rawText.startsWith('DESCRIPTION')) {
        return formatDescription(lines);
    }

    if (rawText.startsWith('RESOURCE')) {
        return formatResource(lines);
    }

    return {
        language: 'json',
        value: rawText
    };
}

function formatField(lines) {
    /*
    source:

    FIELD: name <type>

    DESCRIPTION:
        first line
        second line

    desired output:

    **FIELD:** name <type>

    **DESCRIPTION:**
    first line
    second line
    */

    const formattedLines = lines.map((line) => {
        return removeLeading(emboldenPrefix(line));
    }, this);

    return formattedLines.join('\n')
}

function formatDescription(lines) {
    /*
    source:

    DESCRIPTION:
    first line
    second line

    FIELDS:
        field1 <type>
        first line
        second line

        field2 <type>
        first line
        second line

    desired output:

    **DESCRIPTION:**
    first line
    second line

    **FIELDS:**

    **field1** <type>

    first line
    second line

    **field2** <type>

    first line
    second line
    */

    let parserState = 'init',
        formattedLines = [],
        formatted;

    while (lines.length > 0) {
        let line = lines.shift();
        switch (parserState) {
            case 'init':
                formatted = emboldenPrefix(line);
                formattedLines.push(formatted);
                if (formatted.startsWith('**FIELD')) {
                    formattedLines.push("");
                    parserState = 'fields-none';
                }
                break;
            case 'fields-none':
                formatted = removeLeading(line);
                formatted = emboldenFieldName(formatted);
                formattedLines.push(formatted);
                if (formatted.startsWith('**')) {
                    parserState = 'field-first';
                }
                break;
            case 'field-first':
                if (line.length === 0) {
                    break;
                }
                formatted = removeLeading(line);
                formattedLines.push("");
                formattedLines.push(formatted);
                parserState = 'field-rest';
                break;
            case 'field-rest':
                if (line.length === 0) {
                    parserState = 'fields-none';
                    formattedLines.push(line);
                    break;
                }
                formatted = removeLeading(line);
                formattedLines.push(formatted);
                break;
        }
    }

    return formattedLines.join('\n');
}

function formatResource(lines) {
    /*
    source:

    RESOURCE: name <type>

    DESCRIPTION:
         first summary line
         second summary line

        first line
        second line

    FIELDS:
       field1 <type>
         first line
         second line

       field2 <type>
         first line
         second line

    desired output:

    **RESOURCE:** name <type>

    **DESCRIPTION:**
    first summary line
    second summary line

    first line
    second line

    **FIELDS:**

    **field1** <type>

    first line
    second line

    **field2** <type>

    first line
    second line
    */

    let parserState = 'init',
        formattedLines = [],
        formatted;

    while (lines.length > 0) {
        let line = lines.shift();
        switch (parserState) {
            case 'init':
                formatted = emboldenPrefix(line);
                formattedLines.push(formatted);
                if (formatted.startsWith('**DESCRIPTION')) {
                    parserState = 'description-body';
                }
                if (formatted.startsWith('**FIELD')) {
                    formattedLines.push("");
                    parserState = 'fields-none';
                }
                break;
            case 'description-body':
                formatted = emboldenPrefix(line);
                formatted = removeLeading(formatted);
                formattedLines.push(formatted);
                if (formatted.startsWith('**FIELD')) {
                    formattedLines.push("");
                    parserState = 'fields-none';
                }
                break;
            case 'fields-none':
                formatted = removeLeading(line);
                formatted = emboldenFieldName(formatted);
                formattedLines.push(formatted);
                if (formatted.startsWith('**')) {
                    parserState = 'field-first';
                }
                break;
            case 'field-first':
                if (line.length === 0) {
                    break;
                }
                formatted = removeLeading(line);
                formattedLines.push("");
                formattedLines.push(formatted);
                parserState = 'field-rest';
                break;
            case 'field-rest':
                if (line.length === 0) {
                    parserState = 'fields-none';
                    formattedLines.push(line);
                    break;
                }
                formatted = removeLeading(line);
                formattedLines.push(formatted);
                break;
        }
    }

    return formattedLines.join('\n');
}

function emboldenPrefix(line) {
    if (!line) {
        return line;
    }
    const prefixes = ['FIELD:', 'FIELDS:', 'DESCRIPTION:', 'RESOURCE:'];
    prefixes.forEach((prefix) => {
        if (line.startsWith(prefix)) {
            line = '**' + prefix + '**' + line.substring(prefix.length);
        }
    });
    return line;
}

function emboldenFieldName(line) {
    if (!line) {
        return line;
    }

    const  parse = line.match(/^(\w+)\s+\<(\[\])?\w+\>(\s+-required-)?$/);

    if (parse) {
        line = '**' + parse[1] + '**' + line.substring(parse[1].length)
        if (parse[3]) {
            line = line.replace('-required-', '**[required]**')
        }
    }

    return line;
}

function removeLeading(line) {
    if (!line) {
        return line;
    }
    return line.replace(/^\s+/, '')
}
