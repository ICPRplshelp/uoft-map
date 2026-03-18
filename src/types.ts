export type AcademicYear = Course[];

export interface Course {
    name: string;
    code: string;
    sessions: string[];
    faculty: string;
    facultyName: string;
    campus: string;
    is_cancelled: boolean;
    breadths: Breadths;
    lecture_sections: LectureSection[];
}

export interface Breadths {
    artsc: string[];  // ["BR=1", "BR=2", "BR=3", "BR=4", "BR=5"]
    scar: string[];  // ignore this
    erin: string[]; // ignore this
}

export interface LectureSection {
    section_code: string;
    instructors: Instructor[];
    max_enrolment: number;
    current_enrolment: number;
    meetings: Meeting[];
}

export interface Instructor {
    firstName: string;
    lastName: string;
}

export interface Meeting {
    day: number;
    start_millis: number;
    end_millis: number;
    duration_minutes: number;  // only use this for the duration (this is in minutes!)
    building: string | null;  // BUILDING HERE (two-letter-code), e.g. "AB", "BA"
    buildingRoomNumber: never;  // DO NOT USE
}

export interface BuildingRow {
    code: string;
    name: string;
    address: string;
    postal_code: string;
    lat: string;
    lng: string;
}