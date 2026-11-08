import { AlertCircle, CalendarIcon } from 'lucide-react';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Calendar } from '../ui/calendar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { format } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { formatDateOnly, parseDateOnly } from '../../utils/dateOnly';

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'];

interface TimeEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gigTitle?: string;
  date: string;
  setDate: (date: string) => void;
  startTime: string;
  setStartTime: (time: string) => void;
  endTime: string;
  setEndTime: (time: string) => void;
  onSave: () => void;
}

export function TimeEditDialog({
  open,
  onOpenChange,
  gigTitle,
  date,
  setDate,
  startTime,
  setStartTime,
  endTime,
  setEndTime,
  onSave,
}: TimeEditDialogProps) {
  const isInvalid = !date || !startTime || !endTime || (endTime <= startTime);

  const startHour = startTime ? startTime.substring(0, 2) : '';
  const startMinute = startTime ? startTime.substring(3, 5) : '';
  const endHour = endTime ? endTime.substring(0, 2) : '';
  const endMinute = endTime ? endTime.substring(3, 5) : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Date & Time</DialogTitle>
          <DialogDescription>
            Update the date and times for {gigTitle}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start text-left font-normal">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {date ? formatDateOnly(date, 'PPP') : 'Pick a date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={parseDateOnly(date) ?? undefined}
                  onSelect={(d) => d && setDate(format(d, 'yyyy-MM-dd'))}
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-2">
            <Label>Start Time</Label>
            <div className="flex gap-2 items-center">
              <Select value={startHour} onValueChange={(h) => setStartTime(`${h}:${startMinute || '00'}`)}>
                <SelectTrigger className="w-[80px]"><SelectValue placeholder="HH" /></SelectTrigger>
                <SelectContent>{HOURS.map(h => (
                  <SelectItem key={h} value={h}>{h}</SelectItem>
                ))}</SelectContent>
              </Select>
              <span className="text-muted-foreground font-medium">:</span>
              <Select value={startMinute} onValueChange={(m) => setStartTime(`${startHour || '12'}:${m}`)}>
                <SelectTrigger className="w-[80px]"><SelectValue placeholder="MM" /></SelectTrigger>
                <SelectContent>{MINUTES.map(m => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}</SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>End Time</Label>
            <div className="flex gap-2 items-center">
              <Select value={endHour} onValueChange={(h) => setEndTime(`${h}:${endMinute || '00'}`)}>
                <SelectTrigger className="w-[80px]"><SelectValue placeholder="HH" /></SelectTrigger>
                <SelectContent>{HOURS.map(h => (
                  <SelectItem key={h} value={h}>{h}</SelectItem>
                ))}</SelectContent>
              </Select>
              <span className="text-muted-foreground font-medium">:</span>
              <Select value={endMinute} onValueChange={(m) => setEndTime(`${endHour || '12'}:${m}`)}>
                <SelectTrigger className="w-[80px]"><SelectValue placeholder="MM" /></SelectTrigger>
                <SelectContent>{MINUTES.map(m => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}</SelectContent>
              </Select>
            </div>
          </div>

          {isInvalid && (
            <p className="text-sm text-red-600 flex items-center gap-1">
              <AlertCircle className="w-4 h-4" />
              Please select a valid date and ensure end time is after start time
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={onSave} disabled={isInvalid}>Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
